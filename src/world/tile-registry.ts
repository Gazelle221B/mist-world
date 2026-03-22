// ---------------------------------------------------------------------------
// TileRegistry — maps terrain IDs to render descriptors
//
// Decouples the renderer from terrain metadata. All visual properties
// (color, height, yOffset) are resolved through this registry.
// ---------------------------------------------------------------------------

import { Color4 } from "@babylonjs/core";
import { TERRAINS, TERRAIN_VOID_ID } from "./terrain.ts";

export interface TileDescriptor {
  readonly id: number;
  readonly key: string;
  readonly label: string;
  readonly color: Color4;
  readonly height: number;
  readonly yOffset: number;
}

const VOID_DESCRIPTOR: TileDescriptor = {
  id: TERRAIN_VOID_ID,
  key: "void",
  label: "VOID",
  color: new Color4(0.85, 0.20, 0.30, 1),
  height: 0.1,
  yOffset: -0.6,
};

const descriptors: ReadonlyMap<number, TileDescriptor> = new Map(
  [
    { id: 0, key: "grass",        label: "Grass",         color: new Color4(0.56, 0.74, 0.34, 1), height: 0.30, yOffset: 0.0  },
    { id: 1, key: "sand",         label: "Sand",          color: new Color4(0.87, 0.82, 0.60, 1), height: 0.25, yOffset: -0.05 },
    { id: 2, key: "rock",         label: "Rock",          color: new Color4(0.58, 0.55, 0.52, 1), height: 0.45, yOffset: 0.08 },
    { id: 3, key: "shallowWater", label: "Shallow Water", color: new Color4(0.47, 0.70, 0.82, 1), height: 0.20, yOffset: -0.15 },
    { id: 4, key: "forest",       label: "Forest",        color: new Color4(0.22, 0.50, 0.22, 1), height: 0.35, yOffset: 0.02 },
    { id: 5, key: "deepWater",    label: "Deep Water",    color: new Color4(0.22, 0.42, 0.68, 1), height: 0.15, yOffset: -0.25 },
    VOID_DESCRIPTOR,
  ].map((d) => [d.id, d]),
);

/** Resolve a terrain ID to its render descriptor. Unknown IDs fall back to VOID. */
export function lookupTile(terrainId: number): TileDescriptor {
  return descriptors.get(terrainId) ?? VOID_DESCRIPTOR;
}

/**
 * Verify that every terrain in TERRAINS has a matching registry entry.
 * Called once at boot to catch mismatches early.
 */
export function validateRegistry(): void {
  for (const t of TERRAINS) {
    if (!descriptors.has(t.id)) {
      console.warn(`TileRegistry: missing descriptor for terrain ${t.id} (${t.label})`);
    }
  }
}
