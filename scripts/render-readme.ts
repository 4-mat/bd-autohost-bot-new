// scripts/render-readme.ts
//
// Auto-renders README.md into index.html the way GitHub Pages used to:
// the repo-root README rendered as the site homepage in the Primer
// (github-markdown-css) style -- white background, GitHub markdown layout.
//
//   npm run render:readme
//
// Uses GitHub's Markdown API (GFM mode) so the output matches the GitHub
// rendering the old Jekyll site produced. Unauthenticated requests are
// rate-limited to 60/hour, which is plenty for deploy builds.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = path.join(ROOT, "README.md");
const OUT_PATH = path.join(ROOT, "index.html");

const REPO = process.env.GH_REPO || "4-mat/bd-autohost-bot-new";

const PRIMER_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #ffffff;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
      Helvetica, Arial, sans-serif, "Apple Color Emoji",
      "Segoe UI Emoji", "Segoe UI Symbol";
    font-size: 16px;
    line-height: 1.5;
    word-wrap: break-word;
  }
  .container-lg {
    max-width: 1012px;
    margin: 0 auto;
    padding: 24px 16px 32px;
  }
  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  .markdown-body h1 {
    font-size: 2em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid #d8dee4;
  }
  .markdown-body h1 a {
    color: #1f2328;
    text-decoration: none;
  }
  .markdown-body h2 {
    font-size: 1.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid #d8dee4;
  }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body p { margin-top: 0; margin-bottom: 16px; }
  .markdown-body ul { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
  .markdown-body li { margin-top: 0.25em; }
  .markdown-body li + li { margin-top: 0.25em; }
  .markdown-body a {
    color: #0969da;
    text-decoration: none;
  }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo,
      Consolas, "Liberation Mono", monospace;
    background-color: #eff1f3;
    border-radius: 6px;
    color: #1f2328;
  }
  .markdown-body pre {
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: #f6f8fa;
    border-radius: 6px;
    margin-bottom: 16px;
    margin-top: 0;
  }
  .markdown-body pre code {
    display: inline;
    padding: 0;
    margin: 0;
    font-size: 100%;
    line-height: inherit;
    background-color: transparent;
    border-radius: 0;
    overflow-wrap: normal;
  }
  .markdown-body hr {
    height: 0.25em;
    padding: 0;
    margin: 24px 0;
    background-color: #d8dee4;
    border: 0;
  }
  .markdown-body strong { font-weight: 600; }
`;

async function renderMarkdown(text: string): Promise<string> {
  const resp = await fetch(`https://api.github.com/markdown`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "bd-autohost-bot-new-render-readme",
    },
    body: JSON.stringify({
      text,
      mode: "gfm",
      context: REPO,
    }),
  });
  if (!resp.ok) throw new Error(`GitHub markdown API: HTTP ${resp.status}`);
  return resp.text();
}

function buildPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${PRIMER_CSS}</style>
  </head>
  <body>
    <div class="container-lg my-5 markdown-body">
      ${body}
    </div>
  </body>
</html>
`;
}

async function main() {
  const readme = fs.readFileSync(README_PATH, "utf-8");
  const title = readme.split("\n")[0].replace(/^#\s*/, "").trim();
  const html = await renderMarkdown(readme);
  fs.writeFileSync(OUT_PATH, buildPage(title, html));
  console.log(`Rendered ${path.basename(README_PATH)} -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
