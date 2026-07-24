import { checkAllUpdates } from "./scraper";
import { checkSheet } from "./spec-checker";

async function main() {
  const checkAll = process.argv.includes("--all");

  console.log("Fetching sheets from Google Sheets...\n");
  const { changed, results, diffs } = await checkAllUpdates();

  if (checkAll) {
    // Check compliance on all data
    console.log("Checking BD Lang compliance on all sheets...\n");
    for (const result of results) {
      for (const tab of result.tabs) {
        if (tab.data.length === 0) continue;
        const issues = checkSheet(tab.data);
        if (issues.length === 0) {
          console.log(`  ${tab.label}: All ${tab.data.length} rows compliant.`);
          continue;
        }
        console.log(
          `  ${tab.label}: ${issues.length}/${tab.data.length} ability(ies) with violations:\n`,
        );
        for (const issue of issues) {
          console.log(`    ${issue.name}:`);
          for (const v of issue.violations) {
            const icon = v.severity === "error" ? "ERROR" : "WARN";
            console.log(`      [${icon}] ${v.rule}`);
            console.log(`        Found:    ${v.found}`);
            console.log(`        Suggest:  ${v.suggestion}`);
          }
          console.log();
        }
      }
    }
    return;
  }

  if (!changed) {
    console.log("No changes detected since last check.");
    console.log("Use --all to check compliance on all sheets.");
    return;
  }

  console.log(`Changes detected in ${diffs.length} sheet(s):\n`);

  for (const diff of diffs) {
    console.log(`=== ${diff.label} (${diff.sheet}) ===`);
    if (diff.added.length) {
      console.log(
        `  Added: ${diff.added.map((r) => r.Name || r["Ability Name"] || "unknown").join(", ")}`,
      );
    }
    if (diff.removed.length) {
      console.log(
        `  Removed: ${diff.removed.map((r) => r.Name || r["Ability Name"] || "unknown").join(", ")}`,
      );
    }
    if (diff.changed.length) {
      console.log(`  Modified: ${diff.changed.length} row(s)`);
      for (const c of diff.changed) {
        const name = c.row.Name || c.row["Ability Name"] || "unknown";
        console.log(`    - ${name}:`);
        for (const [field, { from, to }] of Object.entries(c.changes)) {
          console.log(`      ${field}: "${from}" -> "${to}"`);
        }
      }
    }
    console.log();
  }

  // Check BD Lang compliance for changed/new rows
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
    for (const issue of issues) {
      console.log(`    ${issue.name}:`);
      for (const v of issue.violations) {
        const icon = v.severity === "error" ? "ERROR" : "WARN";
        console.log(`      [${icon}] ${v.rule}`);
        console.log(`        Found:    ${v.found}`);
        console.log(`        Suggest:  ${v.suggestion}`);
      }
      console.log();
    }
  }
}

main().catch(console.error);
