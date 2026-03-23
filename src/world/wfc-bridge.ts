// ---------------------------------------------------------------------------
// WFC Bridge — provider-based island generation
//
// The bridge abstracts the WFC generator behind a GeneratorProvider
// interface. At boot, resolveProvider() tries WASM first and falls back
// to a pure-TS provider if the import fails.
// ---------------------------------------------------------------------------

export interface TileData {
  q: number;
  r: number;
  terrain: number;
  prototypeId: number;
  rotation: number;
  elevation: number;
  collapseOrder: number;
}

export interface GenerateResult {
  seedHex: string;
  generator: GeneratorProviderKind;
  radius: number;
  tileCount: number;
  voidCount: number;
  terrainCounts: number[];
  boundaryFixCount: number;
  /** Number of solve attempts used (1-based). */
  attemptsUsed: number;
  /** false when all attempts failed to eliminate VOID tiles. */
  solved: boolean;
  tiles: TileData[];
}

/** Boundary constraint from an already-populated neighbour region. */
export interface BoundaryConstraint {
  q: number;
  r: number;
  dir: number;
  edge_type: number;
}

/** Discriminant for which provider actually ran. */
export type GeneratorProviderKind = "wasm" | "ts-fallback";

/** Kept for backwards compatibility with main.ts RuntimeState type. */
export type PreviewProviderKind = GeneratorProviderKind;
export type PreviewResult = GenerateResult;

/**
 * Thin interface every generator provider must satisfy.
 */
export interface GeneratorProvider {
  readonly kind: GeneratorProviderKind;
  generate(
    seedHi: number,
    seedLo: number,
    radius: number,
    maxAttempts?: number,
  ): GenerateResult;
  generateConstrained(
    seedHi: number,
    seedLo: number,
    radius: number,
    constraints: BoundaryConstraint[],
    maxAttempts?: number,
  ): GenerateResult;
}

// ---------------------------------------------------------------------------
// Hex coordinate helpers (for TS fallback + boundary extraction)
// ---------------------------------------------------------------------------

const HEX_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
] as const;

export { HEX_DIRS };

export function hexSpiral(radius: number): Array<[number, number]> {
  const coords: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= radius; ring++) {
    let q = ring;
    let r = -ring;
    for (let dir = 0; dir < 6; dir++) {
      const [dq, dr] = HEX_DIRS[(dir + 2) % 6];
      for (let step = 0; step < ring; step++) {
        coords.push([q, r]);
        q += dq;
        r += dr;
      }
    }
  }
  return coords;
}

// ---------------------------------------------------------------------------
// Prototype edge table (mirrors Rust PROTOTYPES — must stay in sync)
// ---------------------------------------------------------------------------

/** Edge arrays per prototype index, matching Rust PROTOTYPES order. */
export const PROTO_EDGES: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 0, 0, 0, 0, 0], // 0: GRASS_FULL
  [1, 1, 1, 1, 1, 1], // 1: SAND_FULL
  [2, 2, 2, 2, 2, 2], // 2: ROCK_FULL
  [4, 4, 4, 4, 4, 4], // 3: FOREST_FULL
  [3, 3, 3, 3, 3, 3], // 4: SHALLOW_WATER_FULL
  [5, 5, 5, 5, 5, 5], // 5: DEEP_WATER_FULL
  [1, 1, 1, 3, 3, 3], // 6: COAST_STRAIGHT
  [1, 1, 1, 1, 3, 3], // 7: COAST_CORNER
];

/**
 * Get the edge type at physical direction `dir` for a prototype with
 * rotation `rot`. Mirrors Rust `edge_at()`.
 */
export function edgeAt(protoId: number, dir: number, rot: number): number {
  return PROTO_EDGES[protoId][(dir + 6 - rot) % 6];
}

// ---------------------------------------------------------------------------
// TS-fallback provider (simple hash, no real WFC)
// ---------------------------------------------------------------------------

function terrainFromSeed(seedHi: number, seedLo: number, index: number): number {
  return (((seedHi ^ seedLo) * 2654435761 + index * 2246822519) >>> 0) % 6;
}

function seedToHex(seedHi: number, seedLo: number): string {
  const hi = (seedHi >>> 0).toString(16).padStart(8, "0");
  const lo = (seedLo >>> 0).toString(16).padStart(8, "0");
  return hi + lo;
}

function tsFallbackGenerate(
  seedHi: number,
  seedLo: number,
  radius: number,
): GenerateResult {
  const coords = hexSpiral(radius);
  const tiles: TileData[] = coords.map(([q, r], index) => {
    const terrain = terrainFromSeed(seedHi, seedLo, index);
    return {
      q,
      r,
      terrain,
      prototypeId: terrain, // fallback: 1:1 mapping terrain→prototype
      rotation: 0,
      elevation: 0,
      collapseOrder: index,
    };
  });

  const terrainCounts = [0, 0, 0, 0, 0, 0];
  let voidCount = 0;
  for (const t of tiles) {
    if (t.terrain === 255) {
      voidCount++;
    } else {
      terrainCounts[t.terrain]++;
    }
  }

  return {
    seedHex: seedToHex(seedHi, seedLo),
    generator: "ts-fallback",
    radius,
    tileCount: tiles.length,
    voidCount,
    terrainCounts,
    boundaryFixCount: 0,
    attemptsUsed: 1,
    solved: true,
    tiles,
  };
}

const tsFallbackProvider: GeneratorProvider = {
  kind: "ts-fallback",
  generate: tsFallbackGenerate,
  generateConstrained(
    seedHi: number,
    seedLo: number,
    radius: number,
    _constraints: BoundaryConstraint[],
  ): GenerateResult {
    // TS fallback ignores constraints (not a real WFC)
    return tsFallbackGenerate(seedHi, seedLo, radius);
  },
};

// ---------------------------------------------------------------------------
// WASM provider
// ---------------------------------------------------------------------------

/** Shape of the JSON that Rust's `generate()` / `generate_constrained()` returns. */
interface WasmGenerateJson {
  seed_hex: string;
  generator: string;
  radius: number;
  tile_count: number;
  void_count: number;
  terrain_counts: number[];
  boundary_fix_count: number;
  attempts_used: number;
  solved: boolean;
  tiles: Array<{
    q: number;
    r: number;
    terrain: number;
    prototype_id: number;
    rotation: number;
    elevation: number;
    collapse_order: number;
  }>;
}

function parseWasmJson(raw: string): GenerateResult {
  const json: WasmGenerateJson = JSON.parse(raw);
  const tiles: TileData[] = json.tiles.map((t) => ({
    q: t.q,
    r: t.r,
    terrain: t.terrain,
    prototypeId: t.prototype_id,
    rotation: t.rotation,
    elevation: t.elevation,
    collapseOrder: t.collapse_order,
  }));
  return {
    seedHex: json.seed_hex,
    generator: "wasm",
    radius: json.radius,
    tileCount: tiles.length,
    voidCount: json.void_count,
    terrainCounts: json.terrain_counts,
    boundaryFixCount: json.boundary_fix_count,
    attemptsUsed: json.attempts_used,
    solved: json.solved,
    tiles,
  };
}

interface WasmModule {
  generate: (
    seedHi: number,
    seedLo: number,
    radius: number,
    maxAttempts: number,
  ) => string;
  generate_constrained: (
    seedHi: number,
    seedLo: number,
    radius: number,
    constraintsJson: string,
    maxAttempts: number,
  ) => string;
}

/** Default number of deterministic retry attempts. */
const DEFAULT_MAX_ATTEMPTS = 5;

function createWasmProvider(wasmModule: WasmModule): GeneratorProvider {
  return {
    kind: "wasm",
    generate(
      seedHi: number,
      seedLo: number,
      radius: number,
      maxAttempts?: number,
    ): GenerateResult {
      return parseWasmJson(
        wasmModule.generate(
          seedHi,
          seedLo,
          radius,
          maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        ),
      );
    },
    generateConstrained(
      seedHi: number,
      seedLo: number,
      radius: number,
      constraints: BoundaryConstraint[],
      maxAttempts?: number,
    ): GenerateResult {
      const json = JSON.stringify(constraints);
      return parseWasmJson(
        wasmModule.generate_constrained(
          seedHi,
          seedLo,
          radius,
          json,
          maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        ),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Bridge — provider selection
// ---------------------------------------------------------------------------

/** Resolve the best available provider. Prefers WASM, falls back to TS. */
async function resolveProvider(): Promise<GeneratorProvider> {
  try {
    const wasm = await import("../wasm/mist-wfc/mist_wfc.js");
    await wasm.default();
    return createWasmProvider(wasm as unknown as WasmModule);
  } catch {
    return tsFallbackProvider;
  }
}

let cachedProvider: GeneratorProvider | null = null;

/**
 * Initialise the bridge. Call once at boot; the resolved provider is cached
 * for the lifetime of the page.
 *
 * Returns the provider kind so callers can log / display it.
 */
export async function initBridge(): Promise<GeneratorProviderKind> {
  cachedProvider = await resolveProvider();
  return cachedProvider.kind;
}

/** Default island radius (ring count). */
const DEFAULT_RADIUS = 2;

/**
 * Generate an island using the active provider.
 *
 * If `initBridge()` was not called yet, falls back to `tsFallbackProvider`
 * synchronously — this keeps the API safe even if the caller skips init.
 */
export function generateIsland(
  seedHi: number,
  seedLo: number,
  radius: number = DEFAULT_RADIUS,
  maxAttempts?: number,
): GenerateResult {
  const provider = cachedProvider ?? tsFallbackProvider;
  return provider.generate(seedHi, seedLo, radius, maxAttempts);
}

/**
 * Generate an island with boundary constraints from neighbouring regions.
 */
export function generateIslandConstrained(
  seedHi: number,
  seedLo: number,
  radius: number,
  constraints: BoundaryConstraint[],
  maxAttempts?: number,
): GenerateResult {
  const provider = cachedProvider ?? tsFallbackProvider;
  return provider.generateConstrained(
    seedHi,
    seedLo,
    radius,
    constraints,
    maxAttempts,
  );
}

/**
 * Legacy alias — calls generateIsland with default radius.
 * @deprecated Use generateIsland() instead.
 */
export function generatePreview(seedHi: number, seedLo: number): GenerateResult {
  return generateIsland(seedHi, seedLo, DEFAULT_RADIUS);
}
