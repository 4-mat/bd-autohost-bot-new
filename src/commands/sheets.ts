import { sendPm, sendPmChunks } from "../utils.js";
import type { User } from "../users.js";
import { checkAllUpdates, approveAllUpdates, type DiffResult } from "../sheets/scraper.js";
import {
  checkSheet,
  checkAllSheets,
  rowName,
  type SheetComplianceResult,
} from "../sheets/spec-checker.js";

export async function sheetsCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd !== "sheets") return;

  if (args === "approve") {
    await approveAllUpdates();
    sendPm(target, "Approved pending sheets — merged into local state.");
    return;
  }

  sendPm(target, "Fetching sheets from Google Sheets...");
  const { changed, results, diffs } = await checkAllUpdates();

  if (args === "all") {
    sendPm(target, "Checking BD Lang compliance on all sheets...");
    const report = buildComplianceReport(checkAllSheets(results));
    if (report.length === 0) sendPm(target, "No violations found.");
    else sendPmChunks(target, report);
    return;
  }

  // Default: check for changes
  if (!changed) {
    sendPm(target, "No changes detected since last check.");
    return;
  }

  sendPm(target, `Changes detected in ${diffs.length} sheet(s):`);
  for (const diff of diffs) {
    sendPmChunks(target, buildDiffReport(diff));
  }
}

/** Build the multi-line compliance summary for a full-sheet sweep. */
function buildComplianceReport(compliance: SheetComplianceResult[]): string {
  const lines: string[] = [];
  for (const r of compliance) {
    if (r.issues.length === 0) {
      lines.push(`${r.label}: All ${r.total} rows compliant.`);
      continue;
    }
    lines.push(`${r.label}: ${r.issues.length}/${r.total} with violations:`);
    for (const issue of r.issues) {
      lines.push(`  ${issue.name}:`);
      for (const v of issue.violations) {
        lines.push(`    [${iconFor(v.severity)}] ${v.rule}: ${v.suggestion}`);
      }
    }
  }
  return lines.join("\n");
}

/** Build the report for one changed sheet (added/removed/modified + compliance). */
function buildDiffReport(diff: DiffResult): string {
  const lines: string[] = [`=== ${diff.label} ===`];
  if (diff.added.length) {
    lines.push(
      `  Added: ${diff.added.map((r) => rowName(r) || "?").join(", ")}`,
    );
  }
  if (diff.removed.length) {
    lines.push(
      `  Removed: ${diff.removed.map((r) => rowName(r) || "?").join(", ")}`,
    );
  }
  if (diff.changed.length) {
    lines.push(`  Modified: ${diff.changed.length} row(s)`);
    for (const c of diff.changed) {
      const name = rowName(c.row) || "?";
      lines.push(`    - ${name}:`);
      for (const [field, { from, to }] of Object.entries(c.changes)) {
        lines.push(`      ${field}: "${from}" -> "${to}"`);
      }
    }
  }

  // Check compliance for changed rows
  const allRows = [...diff.added, ...diff.changed.map((c) => c.row)];
  const issues = checkSheet(allRows);
  if (issues.length === 0) {
    lines.push("  Compliance: All changes OK.");
    return lines.join("\n");
  }
  lines.push(`  Compliance: ${issues.length} violation(s):`);
  for (const issue of issues) {
    for (const v of issue.violations) {
      lines.push(`    [${iconFor(v.severity)}] ${issue.name}: ${v.suggestion}`);
    }
  }
  return lines.join("\n");
}

function iconFor(severity: string): string {
  return severity === "error" ? "ERR" : "WARN";
}
