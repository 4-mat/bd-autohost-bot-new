import { sendPm, sendPmChunks } from "../utils.js";
import type { User } from "../users.js";
import { checkAllUpdates } from "../sheets/scraper.js";
import { checkSheet, checkAllSheets } from "../sheets/spec-checker.js";

export async function sheetsCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd === "sheets") {
    sendPm(target, "Fetching sheets from Google Sheets...");
    const { changed, results, diffs } = await checkAllUpdates();

    if (args === "all") {
      sendPm(target, "Checking BD Lang compliance on all sheets...");
      const compliance = checkAllSheets(results);
      const lines: string[] = [];

      for (const r of compliance) {
        if (r.issues.length === 0) {
          lines.push(`${r.label}: All ${r.total} rows compliant.`);
          continue;
        }
        lines.push(
          `${r.label}: ${r.issues.length}/${r.total} with violations:`,
        );
        for (const issue of r.issues) {
          lines.push(`  ${issue.name}:`);
          for (const v of issue.violations) {
            const icon = v.severity === "error" ? "ERR" : "WARN";
            lines.push(`    [${icon}] ${v.rule}: ${v.suggestion}`);
          }
        }
      }

      if (lines.length === 0) {
        sendPm(target, "No violations found.");
      } else {
        sendPmChunks(target, lines.join("\n"));
      }
      return;
    }

    // Default: check for changes
    if (!changed) {
      sendPm(target, "No changes detected since last check.");
      return;
    }

    sendPm(target, `Changes detected in ${diffs.length} sheet(s):`);
    for (const diff of diffs) {
      const lines: string[] = [`=== ${diff.label} ===`];
      if (diff.added.length) {
        lines.push(
          `  Added: ${diff.added.map((r) => r.Name || r["Ability Name"] || "?").join(", ")}`,
        );
      }
      if (diff.removed.length) {
        lines.push(
          `  Removed: ${diff.removed.map((r) => r.Name || r["Ability Name"] || "?").join(", ")}`,
        );
      }
      if (diff.changed.length) {
        lines.push(`  Modified: ${diff.changed.length} row(s)`);
        for (const c of diff.changed) {
          const name = c.row.Name || c.row["Ability Name"] || "?";
          lines.push(`    - ${name}:`);
          for (const [field, { from, to }] of Object.entries(c.changes)) {
            lines.push(`      ${field}: "${from}" -> "${to}"`);
          }
        }
      }

      // Check compliance for changed rows
      const allRows = [...diff.added, ...diff.changed.map((c) => c.row)];
      const issues = checkSheet(allRows);
      if (issues.length > 0) {
        lines.push(`  Compliance: ${issues.length} violation(s):`);
        for (const issue of issues) {
          for (const v of issue.violations) {
            const icon = v.severity === "error" ? "ERR" : "WARN";
            lines.push(`    [${icon}] ${issue.name}: ${v.suggestion}`);
          }
        }
      } else {
        lines.push("  Compliance: All changes OK.");
      }

      sendPmChunks(target, lines.join("\n"));
    }
  }
}
