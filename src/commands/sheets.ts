import { sendPm } from "../utils.js";
import type { User } from "../users.js";
import { checkAllUpdates } from "../sheets/scraper.js";
import { checkSheet } from "../sheets/spec-checker.js";

export async function sheetsCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd === "sheets") {
    sendPm(target, "Fetching sheets from Google Sheets...");
    const { changed, results, diffs } = await checkAllUpdates();

    if (args === "all") {
      // Check compliance on all sheets
      sendPm(target, "Checking BD Lang compliance on all sheets...");
      const lines: string[] = [];

      for (const result of results) {
        for (const tab of result.tabs) {
          if (tab.data.length === 0) continue;
          const issues = checkSheet(tab.data);
          if (issues.length === 0) {
            lines.push(`${tab.label}: All ${tab.data.length} rows compliant.`);
            continue;
          }
          lines.push(
            `${tab.label}: ${issues.length}/${tab.data.length} with violations:`,
          );
          for (const issue of issues) {
            lines.push(`  ${issue.name}:`);
            for (const v of issue.violations) {
              const icon = v.severity === "error" ? "ERR" : "WARN";
              lines.push(`    [${icon}] ${v.rule}: ${v.suggestion}`);
            }
          }
        }
      }

      if (lines.length === 0) {
        sendPm(target, "No violations found.");
      } else {
        // Split into chunks to avoid PM length limits
        const chunk = lines.join("\n");
        sendPm(target, chunk);
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

      sendPm(target, lines.join("\n"));
    }
  }
}
