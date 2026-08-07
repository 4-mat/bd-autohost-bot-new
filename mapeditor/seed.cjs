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
const numToTerrain = {};
for (const m of enumM[1].matchAll(/([A-Za-z_]+)\s*=\s*(\d+)\s*,?/g)) {
	numToTerrain[Number(m[2])] = m[1].toLowerCase();
}

// ---------------------------------------------------------------
// 2) Volunteer maps from maps/*.txt
// ---------------------------------------------------------------
const volunteers = [];
if (fs.existsSync(MAPS_DIR)) {
	for (const f of fs.readdirSync(MAPS_DIR).filter((x) => x.endsWith('.txt')).sort()) {
		try {
			const m = MapCore.parseTxt(fs.readFileSync(path.join(MAPS_DIR, f), 'utf8'), f);
			volunteers.push({ name: m.name, display: m.displayName, format: 'txt', file: f, rows: m.rows, cols: m.cols });
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

if (errors.length) {
	console.error('\nSeed failed with ' + errors.length + ' error(s):');
	for (const e of errors) console.error('  - ' + e);
	process.exit(1);
}

// ---------------------------------------------------------------
// 4) Write maps/curated.json + maps/index.json
// ---------------------------------------------------------------
if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });

fs.writeFileSync(
	path.join(MAPS_DIR, 'curated.json'),
	JSON.stringify({ maps: curated }),
	'utf8'
);
console.log('  + curated.json  (' + curated.length + ' curated maps)');

const manifest = [
	...volunteers,
	...curated.map((c) => ({ name: c.name, display: c.displayName, format: 'curated', file: 'curated.json', rows: c.rows, cols: c.cols }))
];
fs.writeFileSync(
	path.join(MAPS_DIR, 'index.json'),
	JSON.stringify({ maps: manifest }, null, 2),
	'utf8'
);
console.log('  + index.json  (manifest, ' + manifest.length + ' maps)');

console.log('\nDone. Volunteer maps are in maps/*.txt; curated maps come from src/data/maps.ts.');
