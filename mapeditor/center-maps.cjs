/**
 * mapeditor/center-maps.cjs — center the tile patterns of 10x10 maps in
 * src/data/maps.ts whose feature block is not centered in the grid.
 *
 *   node mapeditor/center-maps.cjs
 *
 * For each 10x10 map it finds the bounding box of non-normal tiles and, if
 * the margins around it are uneven, shifts the whole grid (keeping it 10x10)
 * so the margins are as even as possible. Idempotent: running it again makes
 * no changes. Only the grid rows of the affected maps are rewritten (same
 * number of lines in and out) — every other line is left byte-for-byte
 * identical, and the file's line-ending style (LF or CRLF) is preserved.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAPS_TS = path.join(ROOT, 'src', 'data', 'maps.ts');
const STATE_TS = path.join(ROOT, 'src', 'game', 'state.ts');

// Terrain enum order → id (same approach as seed.cjs).
const stateSrc = fs.readFileSync(STATE_TS, 'utf8');
const enumM = stateSrc.match(/export enum Terrain\s*\{([\s\S]*?)\n\}/);
if (!enumM) { console.error('Could not find Terrain enum in ' + STATE_TS); process.exit(1); }
const numToTerrain = {};
for (const m of enumM[1].matchAll(/([A-Za-z_]+)\s*=\s*(\d+)\s*,?/g)) {
	numToTerrain[Number(m[2])] = m[1].toLowerCase();
}

function bbox(grid) {
	let minR = 99, maxR = -1, minC = 99, maxC = -1;
	for (let r = 0; r < grid.length; r++) {
		for (let c = 0; c < grid[r].length; c++) {
			if (grid[r][c] !== 'normal') {
				if (r < minR) minR = r; if (r > maxR) maxR = r;
				if (c < minC) minC = c; if (c > maxC) maxC = c;
			}
		}
	}
	if (maxR === -1) return null;
	return { top: minR, bottom: grid.length - 1 - maxR, left: minC, right: grid[0].length - 1 - maxC };
}

const raw = fs.readFileSync(MAPS_TS, 'utf8');
const crlf = raw.includes('\r\n');
const eol = crlf ? '\r\n' : '\n';
const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));

let i = 0;
const out = [];
let checked = 0;
let fixed = 0;
const marginsAfter = [];
const problems = [];

while (i < lines.length) {
	const m = lines[i].match(/^\s*MAPS\.set\(\s*"([^"]+)"/);
	if (!m) { out.push(lines[i]); i++; continue; }
	const name = m[1];

	// Collect the whole map block (up to and including the `});` line).
	const block = [lines[i]];
	let j = i + 1;
	while (j < lines.length && !/^\}\);\s*$/.test(lines[j])) { block.push(lines[j]); j++; }
	if (j >= lines.length) {
		console.error('Missing closing `});` for map "' + name + '" in ' + MAPS_TS);
		process.exit(1);
	}
	block.push(lines[j]); // `});`

	// Locate the grid rows: from the `grid: [` line to the closing `  ],` line.
	const gi = block.findIndex((l) => /grid:\s*\[/.test(l));
	if (gi !== -1) {
		let close = -1;
		for (let k = gi + 1; k < block.length; k++) {
			if (/^\s*\],\s*$/.test(block[k])) { close = k; break; }
		}
		if (close !== -1) {
			const rowLines = block.slice(gi + 1, close);
			const rows = [];
			for (const rl of rowLines) {
				const rm = rl.match(/^\s*\[([0-9,\s]+)\](,?)\s*$/);
				if (rm) {
					rows.push({
						nums: rm[1].split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n)),
						comma: rm[2] === ','
					});
				}
			}
			let valid = rows.length === 10 && rows[0].nums.length === 10;
			if (valid) {
				for (const r of rows) {
					if (r.nums.length !== 10) {
						valid = false;
						problems.push('map "' + name + '" has a row with ' + r.nums.length + ' cells (expected 10)');
					}
					for (const n of r.nums) if (!(n in numToTerrain)) { valid = false; problems.push('map "' + name + '" uses unknown terrain id ' + n); }
				}
			}
			if (valid) {
				checked++;
				const grid = rows.map((r) => r.nums.map((n) => numToTerrain[n]));
				const b = bbox(grid);
				if (b && !(b.top === b.bottom && b.left === b.right)) {
					const height = 10 - b.top - b.bottom;
					const width = 10 - b.left - b.right;
					const dr = Math.floor((10 - height) / 2) - b.top;
					const dc = Math.floor((10 - width) / 2) - b.left;

					const shifted = Array.from({ length: 10 }, () => new Array(10).fill(0));
					for (let r = 0; r < 10; r++) {
						for (let c = 0; c < 10; c++) {
							const nr = r + dr, nc = c + dc;
							if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) shifted[nr][nc] = rows[r].nums[c];
						}
					}

					const allComma = rows[rows.length - 1].comma;
					const indent = (rowLines[0].match(/^\s*/) || ['    '])[0] || '    ';
					const newRows = shifted.map((row, idx) =>
						indent + '[' + row.join(', ') + ']' + ((allComma || idx < 9) ? ',' : '')
					);
					block.splice(gi + 1, close - gi - 1, ...newRows);

					const nb = bbox(shifted.map((r) => r.map((n) => numToTerrain[n])));
					marginsAfter.push(nb);
					fixed++;
					console.log('  ~ ' + name + '  shifted r:' + (dr > 0 ? '+' + dr : dr) + ' c:' + (dc > 0 ? '+' + dc : dc) +
						'  (was top:' + b.top + ' bottom:' + b.bottom + ' left:' + b.left + ' right:' + b.right +
						'  →  top:' + nb.top + ' bottom:' + nb.bottom + ' left:' + nb.left + ' right:' + nb.right + ')');
				}
			}
		}
	}

	out.push(...block);
	i = j + 1;
}

if (problems.length) {
	console.error('Not rewriting ' + MAPS_TS + ' — invalid maps found:');
	for (const p of problems) console.error('  ! ' + p);
	process.exit(1);
}

// Verification: every 10x10 map should now have margins differing by at most 1.
const bad = marginsAfter.filter((x) => Math.abs(x.top - x.bottom) > 1 || Math.abs(x.left - x.right) > 1);
console.log('\n10x10 maps checked: ' + checked + ' | fixed: ' + fixed + ' | still badly off-center: ' + bad.length);
if (bad.length) {
	for (const b of bad) console.log('  ! ' + JSON.stringify(b));
	process.exit(1);
}

const text = out.join(eol) + (raw.endsWith('\n') && out[out.length - 1] !== '' ? eol : '');
fs.writeFileSync(MAPS_TS, text, 'utf8');
console.log('All 10x10 maps now centered. ✓');
