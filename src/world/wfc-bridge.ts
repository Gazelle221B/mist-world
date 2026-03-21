// ---------------------------------------------------------------------------
// WFC Bridge — provider-based preview generation
//
// The bridge abstracts the preview generator behind a PreviewProvider
// interface. Today only a TS fallback exists; when the Rust/WASM build is
// ready, a "wasm" provider can be added without touching callers.
// ---------------------------------------------------------------------------

export interface TileData {
  q: number;
  r: number;
  terrain: number;
}

export interface PreviewResult {
  seedHex: string;
  generator: PreviewProviderKind;
  tileCount: number;
  tiles: TileData[];
}

/** Discriminant for which provider actually ran. */
export type PreviewProviderKind = "wasm" | "ts-fallback";

/**
 * Thin interface every preview provider must satisfy.
 *
 * `generate` may be sync (ts-fallback) or async (wasm init). The bridge
 * normalises this to always return a Promise.
 */
export interface PreviewProvider {
  readonly kind: PreviewProviderKind;
  generate(seedHi: number, seedLo: number): PreviewResult;
}

// ---------------------------------------------------------------------------
// TS-fallback provider
// ---------------------------------------------------------------------------

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

const tsFallbackProvider: PreviewProvider = {
  kind: "ts-fallback",
  generate(seedHi: number, seedLo: number): PreviewResult {
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
  },
};

// ---------------------------------------------------------------------------
// Bridge — provider selection
// ---------------------------------------------------------------------------

/** Resolve the best available provider. Today: always ts-fallback. */
async function resolveProvider(): Promise<PreviewProvider> {
  // Future: try dynamic-importing the WASM module here.
  //
  //   try {
  //     const wasm = await import("../wasm/mist-wfc/mist_wfc.js");
  //     await wasm.default();          // init WASM
  //     return wasmProvider(wasm);      // wrap in PreviewProvider
  //   } catch { /* fall through */ }
  //
  return tsFallbackProvider;
}

let cachedProvider: PreviewProvider | null = null;

/**
 * Initialise the bridge. Call once at boot; the resolved provider is cached
 * for the lifetime of the page.
 *
 * Returns the provider kind so callers can log / display it.
 */
export async function initBridge(): Promise<PreviewProviderKind> {
  cachedProvider = await resolveProvider();
  return cachedProvider.kind;
}

/**
 * Generate a preview using the active provider.
 *
 * If `initBridge()` was not called yet, falls back to `tsFallbackProvider`
 * synchronously — this keeps the API safe even if the caller skips init.
 */
export function generatePreview(seedHi: number, seedLo: number): PreviewResult {
  const provider = cachedProvider ?? tsFallbackProvider;
  return provider.generate(seedHi, seedLo);
}
