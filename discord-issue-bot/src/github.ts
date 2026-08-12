// Thin GitHub REST client for creating issues. Uses global fetch (Node 20+ /
// Bun) so no extra dependency. The `fetchImpl` param exists only for tests.

// Bound every request: a stalled GitHub API call must not leave a deferred
// Discord interaction hanging in the "thinking" state until its token expires.
const REQUEST_TIMEOUT_MS = 15_000;

function isTimeoutError(e: unknown): boolean {
  return (
    (e as Error).name === "TimeoutError" ||
    (e as Error).name === "AbortError"
  );
}

function timeoutError(method: string, path: string): GithubError {
  return new GithubError(
    `GitHub API ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`,
    0,
    "The GitHub API request timed out.",
  );
}

export interface NewIssue {
  title: string;
  body?: string;
  labels?: string[];
}

export interface CreatedIssue {
  number: number;
  html_url: string;
  title: string;
}

export interface GithubClientOptions {
  token: string;
  repo: string; // "owner/repo"
  fetchImpl?: typeof fetch;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
  }
}

export function createGithubClient(opts: GithubClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${opts.repo}`;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "bd-discord-issue-bot",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (isTimeoutError(e)) throw timeoutError(method, path);
      throw e;
    }
    try {
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new GithubError(
          `GitHub API ${method} ${path} failed (${res.status})`,
          res.status,
          detail.slice(0, 500),
        );
      }
      return (await res.json()) as T;
    } catch (e) {
      // Body decoding can also hit the abort signal when the response
      // stalls after headers arrive — translate it like a fetch timeout,
      // and pass already-typed GithubErrors through unchanged.
      if (e instanceof GithubError) throw e;
      if (isTimeoutError(e)) throw timeoutError(method, path);
      throw e;
    }
  }

  return {
    createIssue(issue: NewIssue): Promise<CreatedIssue> {
      const payload: Record<string, unknown> = {
        title: issue.title,
      };
      if (issue.body) payload.body = issue.body;
      if (issue.labels && issue.labels.length) payload.labels = issue.labels;
      return request<CreatedIssue>("POST", "/issues", payload);
    },
  };
}

export type GithubClient = ReturnType<typeof createGithubClient>;
