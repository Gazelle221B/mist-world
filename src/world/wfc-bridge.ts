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
}

export interface GenerateResult {
  seedHex: string;
  generator: GeneratorProviderKind;
  radius: number;
  tileCount: number;
  tiles: TileData[];
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
  generate(seedHi: number, seedLo: number, radius: number): GenerateResult;
}

// ---------------------------------------------------------------------------
// Hex coordinate helpers (for TS fallback)
// ---------------------------------------------------------------------------

const HEX_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
] as const;

function hexSpiral(radius: number): Array<[number, number]> {
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
// TS-fallback provider (simple hash, no real WFC)
// ---------------------------------------------------------------------------

function terrainFromSeed(seedHi: number, seedLo: number, index: number): number {
  return (((seedHi ^ seedLo) * 2654435761 + index * 2246822519) >>> 0) % 4;
}

function seedToHex(seedHi: number, seedLo: number): string {
  const hi = (seedHi >>> 0).toString(16).padStart(8, "0");
  const lo = (seedLo >>> 0).toString(16).padStart(8, "0");
  return hi + lo;
}

const tsFallbackProvider: GeneratorProvider = {
  kind: "ts-fallback",
  generate(seedHi: number, seedLo: number, radius: number): GenerateResult {
    const coords = hexSpiral(radius);
    const tiles: TileData[] = coords.map(([q, r], index) => ({
      q,
      r,
      terrain: terrainFromSeed(seedHi, seedLo, index),
    }));

    return {
      seedHex: seedToHex(seedHi, seedLo),
      generator: "ts-fallback",
      radius,
      tileCount: tiles.length,
      tiles,
    };
  },
};

// ---------------------------------------------------------------------------
// WASM provider
// ---------------------------------------------------------------------------

/** Shape of the JSON that Rust's `generate()` returns. */
interface WasmGenerateJson {
  seed_hex: string;
  generator: string;
  radius: number;
  tile_count: number;
  tiles: Array<{ q: number; r: number; terrain: number }>;
}

function createWasmProvider(wasmModule: {
  generate: (seedHi: number, seedLo: number, radius: number) => string;
}): GeneratorProvider {
  return {
    kind: "wasm",
    generate(seedHi: number, seedLo: number, radius: number): GenerateResult {
      const json: WasmGenerateJson = JSON.parse(
        wasmModule.generate(seedHi, seedLo, radius),
      );
      const tiles: TileData[] = json.tiles.map((t) => ({
        q: t.q,
        r: t.r,
        terrain: t.terrain,
      }));
      return {
        seedHex: json.seed_hex,
        generator: "wasm",
        radius: json.radius,
        tileCount: tiles.length,
        tiles,
      };
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
    return createWasmProvider(wasm);
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
const DEFAULT_RADIUS = 1;

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
): GenerateResult {
  const provider = cachedProvider ?? tsFallbackProvider;
  return provider.generate(seedHi, seedLo, radius);
}

/**
 * Legacy alias — calls generateIsland with default radius.
 * @deprecated Use generateIsland() instead.
 */
export function generatePreview(seedHi: number, seedLo: number): GenerateResult {
  return generateIsland(seedHi, seedLo, DEFAULT_RADIUS);
}
