import { checkAllUpdates, type DiffResult } from "./scraper.js";
import {
  checkAllSheets,
  checkSheet,
  rowName,
  type SheetComplianceResult,
  type Violation,
} from "./spec-checker.js";

async function main() {
  const checkAll = process.argv.includes("--all");

  console.log("Fetching sheets from Google Sheets...\n");
  const { changed, results, diffs } = await checkAllUpdates();

  if (checkAll) {
    console.log("Checking BD Lang compliance on all sheets...\n");
    printComplianceReport(checkAllSheets(results));
    return;
  }

  if (!changed) {
    console.log("No changes detected since last check.");
    console.log("Use --all to check compliance on all sheets.");
    return;
  }

  console.log(`Changes detected in ${diffs.length} sheet(s):\n`);
  for (const diff of diffs) {
    console.log(printDiff(diff));
    console.log();
  }

  console.log("Checking BD Lang compliance...\n");
  for (const diff of diffs) {
    const allRows = [...diff.added, ...diff.changed.map((c) => c.row)];
    const issues = checkSheet(allRows);
    if (issues.length === 0) {
      console.log(`  ${diff.label}: All changes are BD Lang compliant.`);
      continue;
    }
    console.log(
      `  ${diff.label}: ${issues.length} ability(ies) with violations:\n`,
    );
    console.log(printViolations(issues));
  }
}

/** Print the compliance summary for a full-sheet sweep. */
function printComplianceReport(compliance: SheetComplianceResult[]) {
  for (const r of compliance) {
    if (r.issues.length === 0) {
      console.log(`  ${r.label}: All ${r.total} rows compliant.`);
      continue;
    }
    console.log(
      `  ${r.label}: ${r.issues.length}/${r.total} ability(ies) with violations:\n`,
    );
    console.log(printViolations(r.issues));
  }
}

/** Build the added/removed/modified summary for one changed sheet. */
function printDiff(diff: DiffResult): string {
  const lines: string[] = [`=== ${diff.label} (${diff.sheet}) ===`];
  if (diff.added.length) {
    lines.push(
      `  Added: ${diff.added.map((r) => rowName(r) || "unknown").join(", ")}`,
    );
  }
  if (diff.removed.length) {
    lines.push(
      `  Removed: ${diff.removed
        .map((r) => rowName(r) || "unknown")
        .join(", ")}`,
    );
  }
  if (diff.changed.length) {
    lines.push(`  Modified: ${diff.changed.length} row(s)`);
    for (const c of diff.changed) {
      const name = rowName(c.row) || "unknown";
      lines.push(`    - ${name}:`);
      for (const [field, { from, to }] of Object.entries(c.changes)) {
        lines.push(`      ${field}: "${from}" -> "${to}"`);
      }
    }
  }
  return lines.join("\n");
}

/** Build the formatted violation list for a set of issues. */
function printViolations(
  issues: { name: string; violations: Violation[] }[],
): string {
  const lines: string[] = [];
  for (const issue of issues) {
    lines.push(`    ${issue.name}:`);
    for (const v of issue.violations) {
      const icon = v.severity === "error" ? "ERROR" : "WARN";
      lines.push(`      [${icon}] ${v.rule}`);
      lines.push(`        Found:    ${v.found}`);
      lines.push(`        Suggest:  ${v.suggestion}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

main().catch(console.error);
