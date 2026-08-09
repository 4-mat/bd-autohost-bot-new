// scripts/build-editor-demo.ts
//
// Builds the PUBLIC static demo of the Ability Editor for GitHub Pages:
//
//   npm run editor:demo:build
//
// Reads the same data the bot uses (src/data/index.ts), then produces
// dist-editor/index.html — a fully self-contained copy of the editor GUI with
// the current class/weapon data embedded. The GUI detects the embedded data
// and runs in "static demo" mode: edits + custom test classes/weapons live in
// each visitor's browser (localStorage), and "Propose to Bot" opens a GitHub
// issue that a workflow turns into a PR.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadGameData, classes, weapons } from "../src/data/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUI_PATH = path.join(ROOT, "abilityeditor", "index.html");
const OUT_DIR = path.join(ROOT, "dist-editor");
const OUT_PATH = path.join(OUT_DIR, "index.html");

// Owner/repo for the pre-filled proposal issues. Override with EDITOR_REPO
// if the project moves (e.g. EDITOR_REPO=some-user/their-repo).
const REPO = process.env.EDITOR_REPO || "4-mat/bd-autohost-bot-new";

loadGameData();

const snapshot = {
  classes: [...classes.values()],
  weapons: [...weapons.values()],
};

const build = {
  builtAt: new Date().toISOString(),
  source: "src/data/index.ts",
};

const injection =
  "<script>window.__BD_EDITOR_DATA__=" +
  JSON.stringify(snapshot) +
  ";window.__BD_EDITOR_REPO__=" +
  JSON.stringify(REPO) +
  ";window.__BD_EDITOR_BUILD__=" +
  JSON.stringify(build) +
  ";</script>";

let html = fs.readFileSync(GUI_PATH, "utf8");
const marker = "</head>";
if (!html.includes(marker)) {
  throw new Error("Could not find </head> in abilityeditor/index.html");
}
html = html.replace(marker, injection + "\n  " + marker);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, html);

console.log(
  `[editor-demo] wrote ${OUT_PATH} (${(OUT_PATH && fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB, ` +
    `${snapshot.classes.length} classes, ${snapshot.weapons.length} weapons, repo ${REPO})`,
);
