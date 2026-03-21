export interface TileData {
  q: number;
  r: number;
  terrain: number;
}

export interface PreviewResult {
  seedHex: string;
  generator: "wasm" | "ts-fallback";
  tileCount: number;
  tiles: TileData[];
}

const RING_COORDS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

function terrainFromSeed(seedHi: number, seedLo: number, index: number): number {
  return (((seedHi ^ seedLo) * 2654435761 + index * 2246822519) >>> 0) % 4;
}

function seedToHex(seedHi: number, seedLo: number): string {
  const hi = (seedHi >>> 0).toString(16).padStart(8, "0");
  const lo = (seedLo >>> 0).toString(16).padStart(8, "0");
  return hi + lo;
}

export function generatePreview(seedHi: number, seedLo: number): PreviewResult {
  const tiles: TileData[] = RING_COORDS.map(([q, r], index) => ({
    q,
    r,
    terrain: terrainFromSeed(seedHi, seedLo, index),
  }));

  return {
    seedHex: seedToHex(seedHi, seedLo),
    generator: "ts-fallback",
    tileCount: tiles.length,
    tiles,
  };
}
