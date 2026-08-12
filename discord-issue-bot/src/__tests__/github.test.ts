import { describe, it, expect } from "bun:test";
import { createGithubClient, GithubError } from "../github.js";

function mockFetchImpl(handler: (url: string, init: RequestInit) => Response) {
  return handler as unknown as typeof fetch;
}

describe("createGithubClient", () => {
  it("posts an issue and returns its URL", async () => {
    const client = createGithubClient({
      token: "tok",
      repo: "4-mat/bd-autohost-bot-new",
      fetchImpl: mockFetchImpl((url, init) => {
        expect(url).toBe(
          "https://api.github.com/repos/4-mat/bd-autohost-bot-new/issues",
        );
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body));
        expect(body.title).toBe("Bug: something");
        expect(body.labels).toEqual(["bug"]);
        return new Response(
          JSON.stringify({ number: 42, html_url: "https://github.com/x/42", title: "Bug: something" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    });

    const issue = await client.createIssue({
      title: "Bug: something",
      labels: ["bug"],
    });
    expect(issue.number).toBe(42);
    expect(issue.html_url).toBe("https://github.com/x/42");
  });

  it("does not send a body or labels when omitted", async () => {
    const client = createGithubClient({
      token: "tok",
      repo: "o/r",
      fetchImpl: mockFetchImpl((url, init) => {
        const body = JSON.parse(String(init.body));
        expect(body.body).toBeUndefined();
        expect(body.labels).toBeUndefined();
        return new Response(JSON.stringify({ number: 1, html_url: "u", title: "t" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }),
    });
    const issue = await client.createIssue({ title: "t" });
    expect(issue.number).toBe(1);
  });

  it("throws GithubError with status on API failure", async () => {
    const client = createGithubClient({
      token: "tok",
      repo: "o/r",
      fetchImpl: mockFetchImpl(() => new Response("rate limited", { status: 403 })),
    });
    const e = await client.createIssue({ title: "t" }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(GithubError);
    expect((e as GithubError).status).toBe(403);
    expect((e as GithubError).detail).toContain("rate limited");
  });

  it("translates a timed-out request into a GithubError", async () => {
    const client = createGithubClient({
      token: "tok",
      repo: "o/r",
      fetchImpl: mockFetchImpl(() => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }),
    });
    const e = await client.createIssue({ title: "t" }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(GithubError);
    expect((e as GithubError).status).toBe(0);
    expect((e as GithubError).message).toContain("timed out");
  });

  it("sends auth + version headers", async () => {
    let headers: Headers | undefined;
    const client = createGithubClient({
      token: "secret-token",
      repo: "o/r",
      fetchImpl: mockFetchImpl((url, init) => {
        // Bun may pass init.headers as a plain object; normalize for asserts.
        headers = new Headers(init.headers as HeadersInit);
        return new Response(JSON.stringify({ number: 1, html_url: "u", title: "t" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }),
    });
    await client.createIssue({ title: "t" });
    expect(headers!.get("Authorization")).toBe("Bearer secret-token");
    expect(headers!.get("X-GitHub-Api-Version")).toBe("2022-11-28");
  });
});
