#!/usr/bin/env node
// make-prompt.mjs
//
// Reads CHECKLIST.md and turns every [x]-checked item into a copy-paste
// prompt for an AI agent to ship those features as draft PRs against master.
//
// Usage:
//   node scripts/make-prompt.mjs            # reads CHECKLIST.md in the repo root
//   node scripts/make-prompt.mjs <file>     # read a different checklist
//
// Output goes to stdout; redirect to a file if you want:
//   node scripts/make-prompt.mjs > prompt.md

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(here, "..", "CHECKLIST.md");
const src = readFileSync(process.argv[2] ?? defaultPath, "utf8").replace(
  /\r\n/g,
  "\n",
);

let section = null; // "features" | "deferred" | null
let groupTitle = "";
let commits = [];
const selected = []; // { num, desc, group, commits }
const deferred = []; // { desc }

for (const line of src.split("\n")) {
  if (line.startsWith("## Suggested PR groupings")) section = "features";
  else if (line.startsWith("## Deferred ideas")) section = "deferred";
  else if (line.startsWith("## ")) section = null;

  // Group heading: "### A. Title — commits `sha`, `sha`"
  const group = line.match(/^###\s+(.+?)\s+—\s+commits?\s+(.+)$/);
  if (group) {
    groupTitle = group[1].trim();
    commits = [...group[2].matchAll(/`([0-9a-f]{7,})`/g)].map((m) => m[1]);
    continue;
  }

  if (section === "features") {
    const m = line.match(/^-\s+\[([ xX])\]\s+(\d+)\.\s+(.+)$/);
    if (m && /[xX]/.test(m[1])) {
      selected.push({
        num: m[2],
        desc: m[3],
        group: groupTitle,
        commits: [...commits],
      });
    }
  } else if (section === "deferred") {
    const m = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (m && /[xX]/.test(m[1])) deferred.push(m[2]);
  }
}

if (selected.length === 0 && deferred.length === 0) {
  console.error(
    "No items checked. Edit CHECKLIST.md and mark features with [x], then re-run.",
  );
  process.exit(0);
}

const out = [];
const push = (...parts) => {
  if (parts.length === 0) out.push("");
  else for (const p of parts) out.push(p);
};

push(
  "You are working in the git repo `4-mat/bd-autohost-bot-new`. A finished, unpushed branch",
  "`feat/feature-sprint` (worktree `bd-autohost-bot-new-wtfs`) holds committed features that are",
  "not on `origin/master`. Ship the checked features below as focused DRAFT PRs targeting `master`.",
);

if (selected.length > 0) {
  push();
  push("## Selected features (already implemented — cherry-pick, don't reimplement)");
  push();
  for (const f of selected) {
    const sha = f.commits.length ? ` — commit \`${f.commits.join("`, `")}\`` : "";
    push(`- ${f.num}. ${f.desc}${sha}`);
  }
  push();
  push(
    "Group features that share a commit into a single PR; otherwise split by concern. Prefer",
    "`git cherry-pick <sha>` (or `git diff origin/master..<sha>` applied to a fresh branch) so the",
    "already-tested code is shipped as-is rather than reimplemented.",
  );
}

if (deferred.length > 0) {
  push();
  push("## New work to implement (not built yet)");
  push();
  for (const d of deferred) push(`- ${d}`);
  push();
  push(
    "Implement these from scratch in additional draft PRs, following the same codebase conventions.",
  );
}

push();
push("## Rules (repo AGENTS.md — non-negotiable)");
push();
push(
  "1. Every PR targeting `master` MUST stay DRAFT until BOTH review bots approve:",
  "   CodeRabbit (`coderabbitai[bot]`, review state APPROVED) AND the PR Agent",
  "   (`github-actions[bot]`, review completed with no blocking findings).",
  "2. NEVER push to `master` or merge/un-draft a PR without both approvals.",
  "3. NEVER mention tests, test counts, or test results in PR titles, descriptions,",
  "   commit messages, or any chat output. Run `bun test` and typecheck internally only.",
  "4. When resolving an abstraction, inline duplicated expressions and extract a shared",
  "   helper or a loop over identically-shaped items (per the AGENTS.md abstraction lens).",
);
push();
push("## Deliverable");
push();
push(
  "For each PR: report its number, source branch, target (`master`), and a one-line summary.",
  "Keep PRs small, single-purpose, and in DRAFT.",
);

process.stdout.write(out.join("\n") + "\n");
