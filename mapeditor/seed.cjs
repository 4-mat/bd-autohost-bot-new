/**
 * mapeditor/seed.js — build the editor's map data for bd-autohost-bot-new.
 *
 *   node mapeditor/seed.js
 *
 * Reads:
 *   - maps/*.txt            volunteer maps (the bot's native format)
 *   - src/data/maps.ts      the curated map database (Terrain[][] grids)
 *   - src/game/state.ts     Terrain enum order (number -> terrain id)
 *
 * Writes:
 *   - maps/curated.json     all curated maps, converted to editor JSON
 *   - maps/index.json       manifest the editor uses to list/load maps
 *   - maps/modes.json       game-mode map pools (from src/data/gamemodes.ts)
 *
 * Volunteer .txt files are read-only here — the editor downloads edited
 * maps as .txt which you drop back into maps/ (then run `bun run maps`).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const MapCore = require('./mapcore.cjs');

const ROOT = path.join(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'maps');
const STATE_TS = path.join(ROOT, 'src', 'game', 'state.ts');
const MAPS_TS = path.join(ROOT, 'src', 'data', 'maps.ts');

const errors = [];

// ---------------------------------------------------------------
// 1) Terrain enum order — parsed live from state.ts so it can never drift.
// ---------------------------------------------------------------
const stateSrc = fs.readFileSync(STATE_TS, 'utf8');
const enumM = stateSrc.match(/export enum Terrain\s*\{([\s\S]*?)\n\}/);
if (!enumM) {
	console.error('Could not find the Terrain enum in ' + STATE_TS);
	process.exit(1);
}
const members = [];
let num = -1;
for (const seg of enumM[1].split(',')) {
	const mm = seg.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(\d+))?/);
	if (!mm) continue;
	num = mm[2] !== undefined ? Number(mm[2]) : num + 1;
	members.push([mm[1].toLowerCase(), num]);
}
const numToTerrain = {};
for (const m of members) numToTerrain[m[1]] = m[0];
if (members.length !== Object.keys(numToTerrain).length) {
	errors.push('Terrain enum in ' + STATE_TS + ' has colliding or unmappable members; seed cannot map them');
}

// ---------------------------------------------------------------
// 2) Volunteer maps from maps/*.txt
// ---------------------------------------------------------------
const volunteers = [];
if (fs.existsSync(MAPS_DIR)) {
	for (const f of fs.readdirSync(MAPS_DIR).filter((x) => x.endsWith('.txt')).sort()) {
		try {
			const m = MapCore.parseTxt(fs.readFileSync(path.join(MAPS_DIR, f), 'utf8'), f);
			volunteers.push({ name: m.name, display: m.displayName, format: 'txt', file: f, rows: m.rows, cols: m.cols, modes: m.modes || [] });
			console.log('  volunteer  ' + f + '  (' + m.rows + 'x' + m.cols + ' — ' + m.displayName + ')');
		} catch (e) {
			errors.push(String(e.message));
			console.error('  ! ' + e.message);
		}
	}
}

// ---------------------------------------------------------------
// 3) Curated maps from src/data/maps.ts
// ---------------------------------------------------------------
const curated = [];
if (fs.existsSync(MAPS_TS)) {
	const mapsSrc = fs.readFileSync(MAPS_TS, 'utf8');
	const blockRe = /MAPS\.set\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\n\}\);/g;
	let bm;
	while ((bm = blockRe.exec(mapsSrc)) !== null) {
		const name = bm[1];
		const body = bm[2];
		const dispM = body.match(/displayName\s*:\s*"([^"]*)"/);
		const gridIdx = body.indexOf('grid:');
		if (gridIdx === -1) { errors.push(name + ': no grid found'); continue; }

		const gridText = body.slice(gridIdx + 5);
		const tiles = [];
		const rowRe = /\[([0-9\s,]+)\]/g;
		let rm;
		while ((rm = rowRe.exec(gridText)) !== null) {
			const nums = rm[1].split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
			if (!nums.length) continue;
			tiles.push(nums.map((n) => numToTerrain[n] || 'normal'));
		}
		if (!tiles.length) { errors.push(name + ': no grid rows'); continue; }
		if (tiles.some((r) => r.length !== tiles[0].length)) {
			errors.push(name + ': rows have inconsistent lengths (expected ' + tiles[0].length + ')');
			continue;
		}

		curated.push({
			name,
			displayName: (dispM && dispM[1]) || MapCore.displayFromName(name),
			rows: tiles.length,
			cols: tiles[0].length,
			tiles
		});
	}
	if (!curated.length) errors.push('no curated maps extracted from ' + MAPS_TS);
} else {
	errors.push(MAPS_TS + ' not found');
}

// ---------------------------------------------------------------
// 4) Game-mode pools + manifest, then write maps/*.json
// ---------------------------------------------------------------

// Game-mode map pools from src/data/gamemodes.ts (used by the map browser).
const modes = {};
const MODE_LABELS = { ffa: 'FFA', ntr: 'NTR', jugg: 'JUGG', pvp: 'PvP', '1v1': '1v1' };
const GAMEMODES_TS = path.join(ROOT, 'src', 'data', 'gamemodes.ts');
if (!fs.existsSync(GAMEMODES_TS)) {
	errors.push(GAMEMODES_TS + ' not found');
} else {
	const modesSrc = fs.readFileSync(GAMEMODES_TS, 'utf8');
	const gm = modesSrc.match(/GAMEMODE_MAPS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
	if (!gm) {
		errors.push('GAMEMODE_MAPS block not found in ' + GAMEMODES_TS);
	} else {
		for (const block of gm[1].matchAll(/([A-Za-z0-9_"']+)\s*:\s*\[([\s\S]*?)\]/g)) {
			const key = block[1].replace(/["']/g, '');
			const names = [...block[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
			if (names.length) modes[key] = names;
		}
		if (!Object.keys(modes).length) errors.push('no mode pools extracted from ' + GAMEMODES_TS);
	}
}

const manifest = [
	...volunteers,
	...curated.map((c) => ({ name: c.name, display: c.displayName, format: 'curated', file: 'curated.json', rows: c.rows, cols: c.cols }))
];
const seen = new Set();
for (const m of manifest) {
	if (seen.has(m.name)) errors.push('duplicate map name in manifest: ' + m.name);
	seen.add(m.name);
}

if (errors.length) {
	console.error('\nSeed failed with ' + errors.length + ' error(s):');
	for (const e of errors) console.error('  - ' + e);
	process.exit(1);
}

if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });

const modeLabels = {};
for (const k of Object.keys(modes)) modeLabels[k] = MODE_LABELS[k] || k;
fs.writeFileSync(path.join(MAPS_DIR, 'modes.json'), JSON.stringify({ modes, labels: modeLabels }, null, 2), 'utf8');
console.log('  + modes.json  (' + Object.keys(modes).length + ' mode pools)');

fs.writeFileSync(
	path.join(MAPS_DIR, 'curated.json'),
	JSON.stringify({ maps: curated }),
	'utf8'
);
console.log('  + curated.json  (' + curated.length + ' curated maps)');

fs.writeFileSync(
	path.join(MAPS_DIR, 'index.json'),
	JSON.stringify({ maps: manifest }, null, 2),
	'utf8'
);
console.log('  + index.json  (manifest, ' + manifest.length + ' maps)');

console.log('\nDone. Volunteer maps are in maps/*.txt; curated maps come from src/data/maps.ts.');
