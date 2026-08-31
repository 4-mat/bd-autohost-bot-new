/**
 * terrain-colors.cjs — THE single source of truth for Battle Dome terrain
 * colors and the display metadata that travels with them (label, .txt code,
 * dark-palette flag).
 *
 * Every consumer loads this one file:
 *   - src/game/state.ts           import          -> TERRAIN_COLORS / TERRAIN_NAMES
 *   - mapeditor/mapcore.cjs       require()       -> editor palette, CI parser, gallery renderer
 *   - mapeditor/*.html            <script> tag    -> sets globalThis.TERRAIN_COLORS
 *
 * Change a color here and the engine, the map editor, and the gallery all
 * pick it up. Entry order matches the Terrain enum order in src/game/state.ts.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.TERRAIN_COLORS = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	'use strict';
	return {
		normal: { color: '#A9F5A9', label: 'Normal', code: '.', dark: false },
		stop:   { color: '#A9A9A9', label: 'Stop',   code: 's', dark: true },
		water:  { color: '#454FDF', label: 'Water',  code: 'w', dark: true },
		forest: { color: '#226622', label: 'Forest', code: 'f', dark: true },
		ice:    { color: '#33E9E9', label: 'Ice',    code: 'i', dark: false },
		air:    { color: '#B8D3DE', label: 'Air',    code: 'a', dark: false },
		sticky: { color: '#CCCC00', label: 'Sticky', code: 'x', dark: true },
		lava:   { color: '#8B0000', label: 'Lava',   code: 'l', dark: true },
		broken: { color: '#000000', label: 'Broken', code: 'r', dark: true },
		bone:   { color: '#CCCCAA', label: 'Bone',   code: 'b', dark: false },
		stone:  { color: '#4f4a44', label: 'Stone',  code: 'o', dark: true },
		hearth: { color: '#FF6633', label: 'Hearth', code: 'h', dark: true },
		boost:  { color: '#A855F7', label: 'Boost',  code: '+', dark: true }
	};
}));
