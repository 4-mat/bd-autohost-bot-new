export interface TerrainColorEntry {
	/** Hex color used by the engine renderer, map editor, and gallery. */
	color: string;
	/** Display name (TERRAIN_NAMES in state.ts). */
	label: string;
	/** Volunteer .txt terrain character (mapcore/parse-map-file). */
	code: string;
	/** Whether the palette swatch should use a light label (map editor). */
	dark: boolean;
}

declare const terrainColors: {
	normal: TerrainColorEntry;
	stop: TerrainColorEntry;
	water: TerrainColorEntry;
	forest: TerrainColorEntry;
	ice: TerrainColorEntry;
	air: TerrainColorEntry;
	sticky: TerrainColorEntry;
	lava: TerrainColorEntry;
	broken: TerrainColorEntry;
	bone: TerrainColorEntry;
	stone: TerrainColorEntry;
	hearth: TerrainColorEntry;
	boost: TerrainColorEntry;
};

export = terrainColors;
