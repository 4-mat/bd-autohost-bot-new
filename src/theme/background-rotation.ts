export const DARK_PASTEL_BACKGROUNDS = [
  "#1d1d23",
  "#20252b",
  "#24212b",
  "#202a29",
  "#2a2420",
  "#25232d",
  "#1f2926",
  "#292326",
] as const;

export interface BackgroundRotationState {
  version: string;
  index: number;
}

export function nextBackgroundIndex(
  previousIndex: number,
  paletteLength = DARK_PASTEL_BACKGROUNDS.length,
): number {
  if (paletteLength < 3) return 0;
  const step = 2 + (Math.abs(previousIndex) % (paletteLength - 2));
  return (previousIndex + step) % paletteLength;
}

export function backgroundForVersion(
  version: string,
  previous: BackgroundRotationState | undefined,
): BackgroundRotationState {
  if (previous?.version === version) return previous;
  const previousIndex = previous?.index ?? -1;
  return {
    version,
    index: nextBackgroundIndex(previousIndex),
  };
}

export function isDarkOrPastelBackground(color: string): boolean {
  const match = color.match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max <= 210 && max - min <= 100;
}
