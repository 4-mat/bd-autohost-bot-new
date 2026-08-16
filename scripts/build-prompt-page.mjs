#!/usr/bin/env node
// build-prompt-page.mjs
//
// Regenerates prompt.html from CHECKLIST.md so the page's checklist never
// drifts from the source of truth. Run after editing CHECKLIST.md:
//   node scripts/build-prompt-page.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const md = readFileSync(join(root, "CHECKLIST.md"), "utf8").replace(/\r\n/g, "\n");
const pageJs = readFileSync(join(here, "prompt-page.mjs"), "utf8");

let section = null;
let groupTitle = "";
let commits = [];
const groups = [];
const deferred = [];

for (const line of md.split("\n")) {
  if (line.startsWith("## Suggested PR groupings")) section = "features";
  else if (line.startsWith("## Deferred ideas")) section = "deferred";
  else if (line.startsWith("## ")) section = null;

  const group = line.match(/^###\s+(.+?)\s+—\s+commits?\s+(.+)$/);
  if (group) {
    groupTitle = group[1].trim();
    commits = [...group[2].matchAll(/`([0-9a-f]{7,})`/g)].map((m) => m[1]);
    groups.push({ title: groupTitle, commits: [...commits], items: [] });
    continue;
  }

  if (section === "features") {
    const m = line.match(/^-\s+\[[ xX]\]\s+(\d+)\.\s+(.+)$/);
    if (m && groups.length) {
      groups[groups.length - 1].items.push({ num: m[1], desc: m[2] });
    }
  } else if (section === "deferred") {
    const m = line.match(/^-\s+\[[ xX]\]\s+(.+)$/);
    if (m) deferred.push(m[1]);
  }
}

// Escape "</" so the embedded JSON can't terminate the <script> tag.
const data = JSON.stringify({ groups, deferred }).replace(/<\//g, "<\\/");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feature PR Prompt Builder</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #f6f6f7; color: #1b1b1f; }
  header { padding: 20px 24px; background: #fff; border-bottom: 1px solid #e2e2e5; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #555; font-size: 14px; }
  .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 24px; align-items: start; }
  @media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
  .checklist, .output { background: #fff; border: 1px solid #e2e2e5; border-radius: 8px; padding: 16px; }
  .checklist { max-height: 80vh; overflow: auto; }
  h2 { font-size: 16px; margin: 16px 0 8px; }
  section { margin-bottom: 12px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  .commit { font-weight: normal; color: #888; font-size: 12px; }
  .item { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; font-size: 14px; cursor: pointer; }
  .item code { background: #ececf1; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
  button { padding: 8px 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; font-size: 14px; }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
  textarea { width: 100%; min-height: 60vh; box-sizing: border-box; border: 1px solid #e2e2e5; border-radius: 6px; padding: 10px; font: 12px/1.5 ui-monospace, monospace; resize: vertical; }
  #status { margin-top: 8px; font-size: 13px; color: #555; }
  @media (prefers-color-scheme: dark) {
    body { background: #18181b; color: #e8e8ea; }
    header, .checklist, .output { background: #232327; border-color: #333; }
    .item code { background: #333; }
    button { background: #232327; border-color: #444; color: #e8e8ea; }
    button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
    textarea { background: #1b1b1f; border-color: #333; color: #e8e8ea; }
  }
</style>
</head>
<body>
<header>
  <h1>Feature PR Prompt Builder</h1>
  <p>Check the features you want to ship, then copy the generated prompt.</p>
</header>
<div class="wrap">
  <div class="checklist">
    <h2>Features (already implemented)</h2>
    <div id="groups"></div>
    <h2>Deferred ideas (implement new)</h2>
    <div id="deferred"></div>
  </div>
  <div class="output">
    <div class="toolbar">
      <button id="gen" class="primary">Generate prompt</button>
      <button id="copy">Copy</button>
      <button id="clear">Clear all</button>
    </div>
    <textarea id="out" readonly placeholder="Check items and click Generate prompt"></textarea>
    <div id="status"></div>
  </div>
</div>
<script>
const DATA = ${data};
${pageJs}
</script>
</body>
</html>
`;

writeFileSync(join(root, "prompt.html"), html);
console.log(
  "wrote prompt.html (" +
    groups.length +
    " groups, " +
    deferred.length +
    " deferred ideas)",
);
