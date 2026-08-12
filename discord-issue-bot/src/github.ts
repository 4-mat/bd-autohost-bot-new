// Thin GitHub REST client for creating issues. Uses global fetch (Node 20+ /
// Bun) so no extra dependency. The `fetchImpl` param exists only for tests.

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
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "bd-discord-issue-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GithubError(
        `GitHub API ${method} ${path} failed (${res.status})`,
        res.status,
        detail.slice(0, 500),
      );
    }
    return (await res.json()) as T;
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
