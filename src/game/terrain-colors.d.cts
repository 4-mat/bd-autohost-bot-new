declare namespace terrainColors {
	interface TerrainColorEntry {
		/** Hex color used by the engine renderer, map editor, and gallery. */
		color: string;
		/** Display name (TERRAIN_NAMES in state.ts). */
		label: string;
		/** Volunteer .txt terrain character (mapcore/parse-map-file). */
		code: string;
		/** Whether the palette swatch should use a light label (map editor). */
		dark: boolean;
	}
}

declare const terrainColors: {
	normal: terrainColors.TerrainColorEntry;
	stop: terrainColors.TerrainColorEntry;
	water: terrainColors.TerrainColorEntry;
	forest: terrainColors.TerrainColorEntry;
	ice: terrainColors.TerrainColorEntry;
	air: terrainColors.TerrainColorEntry;
	sticky: terrainColors.TerrainColorEntry;
	lava: terrainColors.TerrainColorEntry;
	broken: terrainColors.TerrainColorEntry;
	bone: terrainColors.TerrainColorEntry;
	stone: terrainColors.TerrainColorEntry;
	hearth: terrainColors.TerrainColorEntry;
	boost: terrainColors.TerrainColorEntry;
};

export = terrainColors;