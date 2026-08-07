"use strict";
const fs = require("fs");

const changes = (process.env.CHANGES || "").split("\n").filter(Boolean);
const valid = new Set(
  (JSON.parse(fs.readFileSync("maps/index.json", "utf8")).maps || []).map(
    (m) => m.name,
  ),
);
const file = "maps/modes.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const summary = [];
const unknown = [];
for (const line of changes) {
  const m = line.match(/^(ffa|ntr|jugg|pvp|1v1)\|([+-])\|([A-Za-z0-9_-]+)$/);
  if (!m) continue;
  const mode = m[1],
    op = m[2],
    name = m[3];
  if (!valid.has(name)) {
    unknown.push(name);
    continue;
  }
  const list = data.modes[mode] || (data.modes[mode] = []);
  if (op === "+" && !list.includes(name)) {
    list.push(name);
    summary.push("add " + name + " to " + mode);
  } else if (op === "-" && list.includes(name)) {
    list.splice(list.indexOf(name), 1);
    summary.push("remove " + name + " from " + mode);
  }
}
if (summary.length && !unknown.length)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
fs.writeFileSync(
  process.env.POOL_RESULT || "/tmp/pool-result.json",
  JSON.stringify({ applied: summary.length > 0, summary, unknown }),
);
