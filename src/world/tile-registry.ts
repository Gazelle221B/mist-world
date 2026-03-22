// ---------------------------------------------------------------------------
// TileRegistry — maps prototype IDs to render descriptors
//
// Two-layer lookup:
//   1. Prototype descriptors (prototypeId → visual overrides)
//   2. Terrain descriptors (terrainId → base visual properties)
//
// The renderer resolves tiles via lookupPrototype(), which returns a
// PrototypeDescriptor containing all visual properties needed for
// rendering. FULL prototypes inherit from their terrain descriptor.
// Transition prototypes (COAST_*) have distinct visual properties.
// ---------------------------------------------------------------------------

import { Color4 } from "@babylonjs/core";
import { TERRAINS, TERRAIN_VOID_ID } from "./terrain.ts";

// ---------------------------------------------------------------------------
// Mesh descriptors — define source geometry per prototype
// ---------------------------------------------------------------------------

export interface PrimitiveMeshDescriptor {
  readonly kind: "primitive";
  readonly primitive: "hex-cylinder";
  readonly key: string;
  readonly tessellation: number;
  readonly diameter: number;
  readonly height: number;
  readonly rotationY: number;
}

export interface GltfMeshDescriptor {
  readonly kind: "gltf";
  readonly key: string;
  readonly assetKey: string;
  readonly meshName: string;
  readonly scale: number;
  readonly rotationY: number;
}

export type MeshDescriptor = PrimitiveMeshDescriptor | GltfMeshDescriptor;

const HEX_CYLINDER: PrimitiveMeshDescriptor = {
  kind: "primitive",
  primitive: "hex-cylinder",
  key: "hex-cylinder",
  tessellation: 6,
  diameter: 1.73,
  height: 1,
  rotationY: Math.PI / 6,
};

// ---------------------------------------------------------------------------
// Tile descriptors (terrain-level, used as base for FULL prototypes)
// ---------------------------------------------------------------------------

export interface TileDescriptor {
  readonly id: number;
  readonly key: string;
  readonly label: string;
  readonly color: Color4;
  readonly height: number;
  readonly yOffset: number;
  readonly mesh: MeshDescriptor;
}

const VOID_TILE: TileDescriptor = {
  id: TERRAIN_VOID_ID,
  key: "void",
  label: "VOID",
  color: new Color4(0.85, 0.20, 0.30, 1),
  height: 0.1,
  yOffset: -0.6,
  mesh: HEX_CYLINDER,
};

const terrainDescriptors: ReadonlyMap<number, TileDescriptor> = new Map(
  [
    { id: 0, key: "grass",        label: "Grass",         color: new Color4(0.56, 0.74, 0.34, 1), height: 0.30, yOffset: 0.0,   mesh: HEX_CYLINDER },
    { id: 1, key: "sand",         label: "Sand",          color: new Color4(0.87, 0.82, 0.60, 1), height: 0.25, yOffset: -0.05, mesh: HEX_CYLINDER },
    { id: 2, key: "rock",         label: "Rock",          color: new Color4(0.58, 0.55, 0.52, 1), height: 0.45, yOffset: 0.08,  mesh: { kind: "gltf" as const, key: "rock-gltf", assetKey: "/assets/terrain/rock.glb", meshName: "", scale: 1, rotationY: 0 } },
    { id: 3, key: "shallowWater", label: "Shallow Water", color: new Color4(0.47, 0.70, 0.82, 1), height: 0.20, yOffset: -0.15, mesh: HEX_CYLINDER },
    { id: 4, key: "forest",       label: "Forest",        color: new Color4(0.22, 0.50, 0.22, 1), height: 0.35, yOffset: 0.02,  mesh: HEX_CYLINDER },
    { id: 5, key: "deepWater",    label: "Deep Water",    color: new Color4(0.22, 0.42, 0.68, 1), height: 0.15, yOffset: -0.25, mesh: HEX_CYLINDER },
    VOID_TILE,
  ].map((d) => [d.id, d]),
);

/** Resolve a terrain ID to its tile descriptor. Unknown IDs fall back to VOID. */
export function lookupTile(terrainId: number): TileDescriptor {
  return terrainDescriptors.get(terrainId) ?? VOID_TILE;
}

// ---------------------------------------------------------------------------
// Prototype descriptors — the renderer's primary lookup
// ---------------------------------------------------------------------------

/**
 * PrototypeDescriptor combines all visual properties the renderer needs.
 * For FULL prototypes these mirror the terrain descriptor.
 * For transition prototypes (COAST_*) they have distinct visuals.
 */
export interface PrototypeDescriptor {
  readonly prototypeId: number;
  readonly key: string;
  readonly label: string;
  readonly terrain: number;
  readonly color: Color4;
  readonly height: number;
  readonly yOffset: number;
  readonly mesh: MeshDescriptor;
}

/** Build a FULL prototype descriptor by inheriting from a terrain descriptor. */
function fullProto(protoId: number, terrainId: number): PrototypeDescriptor {
  const td = lookupTile(terrainId);
  return {
    prototypeId: protoId,
    key: td.key,
    label: td.label,
    terrain: terrainId,
    color: td.color,
    height: td.height,
    yOffset: td.yOffset,
    mesh: td.mesh,
  };
}

const VOID_PROTO: PrototypeDescriptor = {
  prototypeId: 255,
  key: "void",
  label: "VOID",
  terrain: TERRAIN_VOID_ID,
  color: VOID_TILE.color,
  height: VOID_TILE.height,
  yOffset: VOID_TILE.yOffset,
  mesh: VOID_TILE.mesh,
};

/**
 * Prototype registry — must match Rust PROTOTYPES array indices:
 *   0 = GRASS_FULL, 1 = SAND_FULL, 2 = ROCK_FULL, 3 = FOREST_FULL,
 *   4 = SHALLOW_WATER_FULL, 5 = DEEP_WATER_FULL,
 *   6 = COAST_STRAIGHT, 7 = COAST_CORNER
 */
const protoDescriptors: ReadonlyMap<number, PrototypeDescriptor> = new Map(
  [
    fullProto(0, 0), // GRASS_FULL
    fullProto(1, 1), // SAND_FULL
    fullProto(2, 2), // ROCK_FULL
    fullProto(3, 4), // FOREST_FULL (terrain=4)
    fullProto(4, 3), // SHALLOW_WATER_FULL (terrain=3)
    fullProto(5, 5), // DEEP_WATER_FULL

    // COAST_STRAIGHT — sand/shallow transition, half-and-half
    {
      prototypeId: 6,
      key: "coast-straight",
      label: "Coast (Straight)",
      terrain: 1, // sand
      color: new Color4(0.76, 0.78, 0.62, 1), // sand–water blend
      height: 0.22,
      yOffset: -0.10,
      mesh: HEX_CYLINDER,
    },

    // COAST_CORNER — sand/shallow transition, corner piece
    {
      prototypeId: 7,
      key: "coast-corner",
      label: "Coast (Corner)",
      terrain: 1, // sand
      color: new Color4(0.80, 0.80, 0.58, 1), // warmer sand tint
      height: 0.23,
      yOffset: -0.08,
      mesh: HEX_CYLINDER,
    },
  ].map((d) => [d.prototypeId, d]),
);

/**
 * Resolve a prototype ID to its render descriptor.
 * Falls back to terrain-based lookup, then to VOID.
 */
export function lookupPrototype(prototypeId: number, terrain: number): PrototypeDescriptor {
  return protoDescriptors.get(prototypeId) ?? terrainToProto(terrain);
}

/** Convert a terrain ID to a PrototypeDescriptor (for unknown prototypes). */
function terrainToProto(terrainId: number): PrototypeDescriptor {
  const td = terrainDescriptors.get(terrainId);
  if (!td) return VOID_PROTO;
  return {
    prototypeId: 255,
    key: td.key,
    label: td.label,
    terrain: terrainId,
    color: td.color,
    height: td.height,
    yOffset: td.yOffset,
    mesh: td.mesh,
  };
}

/**
 * Verify that every terrain in TERRAINS has a matching registry entry.
 * Called once at boot to catch mismatches early.
 */
export function validateRegistry(): void {
  for (const t of TERRAINS) {
    if (!terrainDescriptors.has(t.id)) {
      console.warn(`TileRegistry: missing terrain descriptor for ${t.id} (${t.label})`);
    }
  }
}
