import { SHEETS } from "./sources";
import { loadState, savePending, loadPending, approvePending } from "./state";

interface SheetRow {
  [key: string]: string;
}

interface FetchResult {
  name: string;
  label: string;
  tabs: {
    name: string;
    label: string;
    data: SheetRow[];
    raw: string;
  }[];
}

interface DiffResult {
  sheet: string;
  tab: string;
  label: string;
  added: SheetRow[];
  removed: SheetRow[];
  changed: {
    row: SheetRow;
    old: SheetRow;
    changes: Record<string, { from: string; to: string }>;
  }[];
}

function csvToRows(csv: string): SheetRow[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: SheetRow = {};
    headers.forEach((h, i) => (row[h.trim()] = (values[i] || "").trim()));
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function rowKey(row: SheetRow): string {
  return row.Name || row.name || row["Ability Name"] || JSON.stringify(row);
}

function diffRows(
  oldRows: SheetRow[],
  newRows: SheetRow[],
): Omit<DiffResult, "sheet" | "tab" | "label"> {
  const oldMap = new Map(oldRows.map((r) => [rowKey(r), r]));
  const newMap = new Map(newRows.map((r) => [rowKey(r), r]));

  const added = newRows.filter((r) => !oldMap.has(rowKey(r)));
  const removed = oldRows.filter((r) => !newMap.has(rowKey(r)));
  const changed: DiffResult["changed"] = [];

  for (const [key, newRow] of newMap) {
    const oldRow = oldMap.get(key);
    if (!oldRow) continue;
    const changes: Record<string, { from: string; to: string }> = {};
    for (const k of Object.keys(newRow)) {
      if (newRow[k] !== oldRow[k]) {
        changes[k] = { from: oldRow[k], to: newRow[k] };
      }
    }
    if (Object.keys(changes).length > 0) {
      changed.push({ row: newRow, old: oldRow, changes });
    }
  }

  return { added, removed, changed };
}

export async function fetchSheet(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

export async function checkAllUpdates(): Promise<{
  changed: boolean;
  results: FetchResult[];
  diffs: DiffResult[];
}> {
  const results: FetchResult[] = [];
  const allDiffs: DiffResult[] = [];
  let anyChanged = false;

  for (const sheet of SHEETS) {
    const tabs: FetchResult["tabs"] = [];
    for (const tab of sheet.sheets) {
      const url = `https://docs.google.com/spreadsheets/d/${sheet.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab.name)}`;
      const raw = await fetchSheet(url);
      const data = csvToRows(raw);
      tabs.push({ name: tab.name, label: tab.label, data, raw });
    }

    results.push({ name: sheet.name, label: sheet.label, tabs });

    const pending = loadPending(sheet.name);
    const approved = loadState(sheet.name);
    const prev = pending ?? approved?.sheets ?? null;
    if (prev) {
      for (const tab of tabs) {
        const prevRaw = prev[tab.name];
        if (!prevRaw) continue;
        const oldData = csvToRows(prevRaw);
        const d = diffRows(oldData, tab.data);
        if (d.added.length || d.removed.length || d.changed.length) {
          anyChanged = true;
          allDiffs.push({
            ...d,
            sheet: sheet.name,
            tab: tab.name,
            label: tab.label,
          });
        }
      }
    }

    const dataMap: Record<string, string> = {};
    for (const tab of tabs) dataMap[tab.name] = tab.raw;
    savePending(sheet.name, dataMap);
  }

  return { changed: anyChanged, results, diffs: allDiffs };
}

export async function approveAllUpdates() {
  for (const sheet of SHEETS) {
    approvePending(sheet.name);
  }
}

export type { DiffResult, SheetRow, FetchResult };
