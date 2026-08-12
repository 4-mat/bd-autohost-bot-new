"use strict";
const fs = require("fs");

function applyPoolChanges(data, changes, valid) {
  const before = JSON.stringify(data);
  const summary = [];
  const unknown = [];
  const ops = [];
  for (const line of changes) {
    const m = line.match(/^(ffa|ntr|jugg|pvp|1v1)\|([+-])\|([A-Za-z0-9_-]+)$/);
    if (!m) continue;
    const mode = m[1],
      op = m[2],
      name = m[3];
    ops.push({ mode, op, name });
    if (!valid.has(name)) unknown.push(name);
  }
  if (unknown.length) return { applied: false, summary, unknown };
  for (const { mode, op, name } of ops) {
    const list = data.modes[mode] || (data.modes[mode] = []);
    if (op === "+" && !list.includes(name)) {
      list.push(name);
      summary.push("add " + name + " to " + mode);
    } else if (op === "-" && list.includes(name)) {
      list.splice(list.indexOf(name), 1);
      summary.push("remove " + name + " from " + mode);
    }
  }
  const applied = JSON.stringify(data) !== before;
  return { applied, summary, unknown };
}

if (require.main === module) {
  const changes = (process.env.CHANGES || "").split("\n").filter(Boolean);
  const valid = new Set(
    (JSON.parse(fs.readFileSync("maps/index.json", "utf8")).maps || []).map(
      (m) => m.name,
    ),
  );
  const file = "maps/modes.json";
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const { applied, summary, unknown } = applyPoolChanges(data, changes, valid);
  if (applied) fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(
    process.env.POOL_RESULT || "/tmp/pool-result.json",
    JSON.stringify({ applied, summary, unknown }),
  );
}

module.exports = { applyPoolChanges };
