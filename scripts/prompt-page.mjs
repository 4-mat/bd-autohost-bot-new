// Runtime logic for prompt.html — inlined by scripts/build-prompt-page.mjs.
// Expects a global `DATA = { groups: [{ title, commits, items: [{ num, desc }] }], deferred: [desc] }`.
(function () {
  const groupsEl = document.getElementById("groups");
  const deferredEl = document.getElementById("deferred");
  const out = document.getElementById("out");
  const status = document.getElementById("status");

  function md(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function row(label, data) {
    const lab = document.createElement("label");
    lab.className = "item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.kind = data.kind;
    box.dataset.num = data.num || "";
    box.dataset.desc = data.desc;
    box.dataset.commits = data.commits ? data.commits.join(",") : "";
    const span = document.createElement("span");
    span.innerHTML = md(label);
    lab.appendChild(box);
    lab.appendChild(span);
    return lab;
  }

  for (const g of DATA.groups) {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.appendChild(document.createTextNode(g.title));
    if (g.commits.length) {
      const c = document.createElement("span");
      c.className = "commit";
      c.textContent = " · commit " + g.commits.join(", ");
      h.appendChild(c);
    }
    sec.appendChild(h);
    for (const it of g.items) {
      sec.appendChild(
        row(it.num + ". " + it.desc, {
          kind: "feature",
          num: it.num,
          desc: it.desc,
          commits: g.commits,
        }),
      );
    }
    groupsEl.appendChild(sec);
  }

  for (const d of DATA.deferred) {
    deferredEl.appendChild(
      row(d, { kind: "deferred", num: "", desc: d, commits: null }),
    );
  }

  function selected() {
    const sel = [];
    const def = [];
    document.querySelectorAll("input[type=checkbox]:checked").forEach((box) => {
      if (box.dataset.kind === "feature") {
        sel.push({
          num: box.dataset.num,
          desc: box.dataset.desc,
          commits: box.dataset.commits ? box.dataset.commits.split(",") : [],
        });
      } else {
        def.push(box.dataset.desc);
      }
    });
    return { sel, def };
  }

  function build() {
    const { sel, def } = selected();
    if (sel.length === 0 && def.length === 0) {
      out.value = "";
      status.textContent = "Nothing selected — check some features first.";
      return;
    }
    const lines = [];
    const push = (...parts) => {
      if (parts.length === 0) lines.push("");
      else parts.forEach((p) => lines.push(p));
    };

    push(
      "You are working in the git repo `4-mat/bd-autohost-bot-new`. A finished, unpushed branch",
      "`feat/feature-sprint` (worktree `bd-autohost-bot-new-wtfs`) holds committed features that are",
      "not on `origin/master`. Ship the checked features below as focused DRAFT PRs targeting `master`.",
    );

    if (sel.length) {
      push();
      push("## Selected features (already implemented — cherry-pick, don't reimplement)");
      push();
      sel.forEach((f) => {
        const sha = f.commits.length
          ? " — commit `" + f.commits.join("`, `") + "`"
          : "";
        push("- " + f.num + ". " + f.desc + sha);
      });
      push();
      push(
        "Group features that share a commit into a single PR; otherwise split by concern. Prefer",
        "`git cherry-pick <sha>` (or `git diff origin/master..<sha>` applied to a fresh branch) so the",
        "already-tested code is shipped as-is rather than reimplemented.",
      );
    }

    if (def.length) {
      push();
      push("## New work to implement (not built yet)");
      push();
      def.forEach((d) => push("- " + d));
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

    out.value = lines.join("\n") + "\n";
    status.textContent =
      "Prompt ready (" +
      sel.length +
      " feature" +
      (sel.length === 1 ? "" : "s") +
      (def.length ? ", " + def.length + " new" : "") +
      ").";
  }

  function fallbackCopy() {
    out.focus();
    out.select();
    try {
      document.execCommand("copy");
      status.textContent = "Copied to clipboard.";
    } catch {
      status.textContent = "Copy failed — select the text and copy manually.";
    }
  }

  function copy() {
    if (!out.value) build();
    if (!out.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out.value).then(
        () => (status.textContent = "Copied to clipboard."),
        () => fallbackCopy(),
      );
    } else {
      fallbackCopy();
    }
  }

  document.getElementById("gen").addEventListener("click", build);
  document.getElementById("copy").addEventListener("click", copy);
  document.getElementById("clear").addEventListener("click", () => {
    document
      .querySelectorAll("input[type=checkbox]:checked")
      .forEach((b) => (b.checked = false));
    out.value = "";
    status.textContent = "Cleared.";
  });
})();
