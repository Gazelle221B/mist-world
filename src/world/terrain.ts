// ---------------------------------------------------------------------------
// Terrain metadata — single source of truth for terrain IDs, labels, colors
// ---------------------------------------------------------------------------

import { Color4 } from "@babylonjs/core";

export interface TerrainMeta {
  readonly id: number;
  readonly label: string;
  readonly color: Color4;
}

/** Terrain definitions indexed by terrain ID (0..5 = placeable). */
export const TERRAINS: readonly TerrainMeta[] = [
  { id: 0, label: "grass",        color: new Color4(0.56, 0.74, 0.34, 1) },
  { id: 1, label: "sand",         color: new Color4(0.87, 0.82, 0.60, 1) },
  { id: 2, label: "rock",         color: new Color4(0.58, 0.55, 0.52, 1) },
  { id: 3, label: "shallowWater", color: new Color4(0.47, 0.70, 0.82, 1) },
  { id: 4, label: "forest",       color: new Color4(0.22, 0.50, 0.22, 1) },
  { id: 5, label: "deepWater",    color: new Color4(0.22, 0.42, 0.68, 1) },
];

/** Number of placeable terrain types (excludes VOID). */
export const TERRAIN_COUNT = 6;

/** VOID terrain ID — sentinel value, never changes when adding terrains. */
export const TERRAIN_VOID_ID = 255;

/** VOID color (contradiction marker — bright red). */
const VOID_COLOR = new Color4(0.85, 0.20, 0.30, 1);

/** Get terrain label by ID, falling back to "void" for unknown IDs. */
export function terrainLabel(id: number): string {
  return TERRAINS[id]?.label ?? "void";
}

/** Get terrain color by ID, falling back to VOID color for unknown IDs. */
export function terrainColor(id: number): Color4 {
  return TERRAINS[id]?.color ?? VOID_COLOR;
}

/**
 * Convert a terrain counts array [grass, sand, rock, water] into
 * a record keyed by terrain label.
 */
export function terrainCountsByName(counts: number[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < TERRAIN_COUNT; i++) {
    result[TERRAINS[i].label] = counts[i] ?? 0;
  }
  return result;
}
