/**
 * mapeditor/server.cjs — tiny local server for the Battle Dome Map Editor
 * (bd-autohost-bot-new).
 *
 *   node mapeditor/server.cjs          → http://localhost:4777
 *   PORT=8080 node mapeditor/server.cjs → http://localhost:8080
 *
 * Serves the editor UI and the maps/ folder statically (same relative paths
 * GitHub Pages uses), and exposes a unified /api/maps list that includes
 * volunteer maps (maps/*.txt), the curated database (maps/curated.json) and
 * any maps saved locally as JSON (maps/*.json).
 *
 * On GitHub Pages there is no server, so Save downloads a volunteer .txt
 * instead — drop it into maps/ and run `bun run maps`.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const MapCore = require('./mapcore.cjs');

const PORT = Number(process.env.PORT) || 4777;
const ROOT = path.join(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'maps');

// Keep mapcore's mode rules in lockstep with the bot's generated data
// (aliases + per-mode min sizes from src/data/gamemodes.ts via seed.cjs).
try {
	const md = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, 'modes.json'), 'utf8'));
	MapCore.setModeData({ aliases: md.aliases || {}, minSizes: md.minSizes || {} });
} catch (e) { /* modes.json missing — fall back to mapcore defaults */ }

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.cjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon'
};

function send(res, code, body, type) {
	if (!res.headersSent) {
		const h = {
			'Content-Type': type || 'application/json; charset=utf-8',
			'Cache-Control': 'no-store'
		};
		if (res.req && (res.req.method === 'GET' || res.req.method === 'HEAD')) h['Access-Control-Allow-Origin'] = '*';
		res.writeHead(code, h);
	}
	if (Buffer.isBuffer(body)) res.end(body);
	else res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			chunks.push(chunk);
			size += chunk.length;
			if (size > 5e6) { reject(new Error('Body too large')); req.destroy(); }
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}
// A browser mutation (Save/Delete) is only accepted when its Origin
// matches this local server; requests without an Origin pass through.
// Mutations are only allowed from loopback, or from an explicit allowlist
// when the server is bound to a non-loopback interface (HOST=0.0.0.0, e.g.
// for LAN editing). ALLOWED_ORIGINS is a comma-separated list of exact
// origins (scheme://host[:port]) — anything else is rejected. Loopback stays
// open by default so the normal local workflow is unaffected.
function allowOrigin(origin) {
	if (!origin) return true;
	try {
		const o = new URL(origin);
		const loop =
			o.hostname === 'localhost' ||
			o.hostname === '127.0.0.1' ||
			o.hostname === '::1' ||
			o.hostname === '[::1]';
		// An origin with no explicit port means the protocol default (80/443);
		// resolve it so a default-port origin can't bypass the PORT check.
		const effectivePort = o.port || (o.protocol === 'https:' ? '443' : '80');
		const portOk = effectivePort === String(PORT);
		if (loop && portOk) return true;
		const allowed = (process.env.ALLOWED_ORIGINS || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		return allowed.includes(origin);
	} catch (e) { return false; }
}

function sanitizeFile(name) {
	return String(name).replace(/[^a-z0-9_-]/gi, '') + '.json';
}

// The unified map list — mirrors what maps/index.json contains, but computed
// live so locally saved JSON maps show up immediately.
function listMaps() {
	const maps = [];
	if (fs.existsSync(MAPS_DIR)) {
		for (const f of fs.readdirSync(MAPS_DIR).sort()) {
			if (f === 'index.json' || f === 'curated.json') continue;
			const file = path.join(MAPS_DIR, f);
			if (f.endsWith('.txt')) {
				try {
					const m = MapCore.parseTxt(fs.readFileSync(file, 'utf8'), f);
					maps.push({ name: m.name, display: m.displayName, format: 'txt', file: f, rows: m.rows, cols: m.cols, modes: m.modes || [] });
				} catch (e) { /* skip invalid volunteer map */ }
			} else if (f.endsWith('.json')) {
				try {
					const m = JSON.parse(fs.readFileSync(file, 'utf8'));
					maps.push({ name: m.name || path.basename(f, '.json'), display: m.displayName || m.name, format: 'json', file: f, rows: m.rows, cols: m.cols });
				} catch (e) { /* skip */ }
			}
		}
	}
	const curatedFile = path.join(MAPS_DIR, 'curated.json');
	if (fs.existsSync(curatedFile)) {
		try {
			const curated = JSON.parse(fs.readFileSync(curatedFile, 'utf8'));
			for (const c of (curated.maps || [])) {
				maps.push({ name: c.name, display: c.displayName || c.name, format: 'curated', file: 'curated.json', rows: c.rows, cols: c.cols });
			}
		} catch (e) { /* skip */ }
	}
	return maps;
}

function getMap(name) {
	const file = path.join(MAPS_DIR, sanitizeFile(name));
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function handle(req, res) {
	const url = new URL(req.url, 'http://localhost');
	const p = url.pathname;

	try {
		// ---- API ----
		if (p === '/api/maps' && req.method === 'GET') {
			return send(res, 200, { maps: listMaps() });
		}

		const m = p.match(/^\/api\/maps\/([a-z0-9_-]+)$/i);
		if (m) {
			const name = m[1];
			if (name === 'index' || name === 'curated') return send(res, 404, { error: 'reserved name' });
			if (req.method === 'GET') {
				const map = getMap(name);
				return map ? send(res, 200, map) : send(res, 404, { error: 'map not found' });
			}
			if (req.method === 'PUT') {
				if (!allowOrigin(req.headers.origin)) return send(res, 403, { error: 'forbidden origin' });
				const body = await readBody(req);
				let raw;
				try { raw = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'invalid JSON body' }); }
				const map = MapCore.normalizeMap(raw);
				map.name = MapCore.sanitizeName(name || map.name);
				if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });
				fs.writeFileSync(path.join(MAPS_DIR, sanitizeFile(map.name)), JSON.stringify(map, null, 2), 'utf8');
				return send(res, 200, { ok: true, name: map.name, file: sanitizeFile(map.name) });
			}
			if (req.method === 'DELETE') {
				if (!allowOrigin(req.headers.origin)) return send(res, 403, { error: 'forbidden origin' });
				const file = path.join(MAPS_DIR, sanitizeFile(name));
				if (fs.existsSync(file)) fs.unlinkSync(file);
				return send(res, 200, { ok: true });
			}
			return send(res, 405, { error: 'method not allowed' });
		}

		if (p === '/api/health' && req.method === 'GET') {
			return send(res, 200, { ok: true });
		}

		// ---- Static files (serve the editor UI and the maps/ folder exactly
		//      like GitHub Pages does) ----
		let rel;
		if (p === '/' || p === '/mapeditor' || p === '/mapeditor/') rel = 'mapeditor/index.html';
		else if (p.startsWith('/mapeditor/') || p.startsWith('/maps/')) rel = p.replace(/^\/+/, '');
		else return send(res, 403, { error: 'forbidden' });
		let file = path.normalize(path.join(ROOT, rel));
		const inside = file === ROOT || file.startsWith(ROOT + path.sep);
		if (!inside) return send(res, 403, { error: 'forbidden' });
		if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
		const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
		return send(res, 200, fs.readFileSync(file), type);
	} catch (e) {
		return send(res, 500, { error: e.message });
	}
}

const server = http.createServer((req, res) => {
	handle(req, res).catch((e) => send(res, 500, { error: e.message }));
});

const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
	console.log('==============================================');
	console.log('  Battle Dome Map Editor');
	console.log('  ->  http://' + (HOST === '127.0.0.1' ? 'localhost' : HOST) + ':' + PORT + '/');
	console.log('  maps dir: ' + MAPS_DIR);
	console.log('==============================================');
});
