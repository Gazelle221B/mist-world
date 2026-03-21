# Seeded Island Preview — Vertical Slice Design

**Date:** 2026-03-21
**Status:** Approved
**Sprint:** Sprint 0 → Sprint 1 bridge

## Goal

Connect `seed -> Rust/WASM (or TS fallback) -> axial tile list -> Babylon rendering` end-to-end. This is the smallest vertical slice that exercises the Sprint 1 core pipeline without pulling in mistlib, Loro, Havok, or KayKit assets.

## Completion Criteria

- Fixed seed produces identical browser display on every load
- WebGPU and WebGL2 both show the same tile arrangement
- `npm run build` and `npm run typecheck` pass
- `main.ts` is boot-only; world generation, coordinate math, and rendering live in dedicated modules
- `render_game_to_text()` includes `seedHex`, `tileCount`, `tiles`, and `generator` fields

## Architecture

```
seed (8 bytes: seedHi u32 + seedLo u32)
  |
  v
WfcBridge.ts          -- provider abstraction (TS fallback now, WASM later)
  |
  v
TileData[] = {q, r, terrain}[]
  |
  v
hex-grid.ts           -- axial (q,r) -> Babylon world coords (x, z)
  |
  v
IslandRenderer.ts     -- 1 source hex mesh + Thin Instances (matrix + color buffer)
  |
  v
main.ts               -- boot only: engine init -> bridge.generate -> render
```

## Module Design

### `src/world/wfc-bridge.ts`

**Responsibility:** Seed-to-tiles generation, abstracting the provider.

```typescript
export interface TileData {
  q: number;
  r: number;
  terrain: number;
}

export interface PreviewResult {
  seedHex: string;          // format: 16 hex chars, no prefix (e.g. "deadbeefcafe0001")
  generator: "wasm" | "ts-fallback";
  tileCount: number;        // tiles.length (convenience for render_game_to_text)
  tiles: TileData[];
}

export function generatePreview(seedHi: number, seedLo: number): PreviewResult;
```

- Current implementation: pure-TS fallback that reproduces the same 7 fixed axial coordinates as `lib.rs` `[(0,0), (1,0), (1,-1), (0,-1), (-1,0), (-1,1), (0,1)]` (clockwise ring traversal — must match Rust order since terrain depends on tile index)
- Terrain assignment: deterministic hash `((seedHi ^ seedLo) * 2654435761 + index * 2246822519) >>> 0 % 4` (Knuth multiplicative hash variant; does NOT match ChaCha8 output)
- `seedHex` format: 16 hex chars, zero-padded, no `0x` prefix — matches Rust's `format!("{seed_hi:08x}{seed_lo:08x}")`
- Rust's `PreviewWorld.dominant_terrain` is intentionally omitted from `PreviewResult` — not needed for rendering. Will be handled in the bridge when WASM is integrated
- The TS fallback does NOT need to match Rust's ChaCha8 output bit-for-bit. It must be deterministic for a given seed, but cross-runtime parity is guaranteed only by the WASM path
- `generator` field distinguishes which provider produced the output
- WASM integration point: when `wasm-pack` becomes available, add dynamic `import()` of the WASM module inside this bridge. The public API does not change

### `src/world/hex-grid.ts`

**Responsibility:** Axial coordinate to Babylon world position conversion.

```typescript
export function axialToWorld(q: number, r: number): { x: number; z: number };
```

- Flat-top hex layout, size = 1.0
- Formula: `x = 1.5 * q`, `z = sqrt(3)/2 * q + sqrt(3) * r`
- Pure function, no Babylon dependency
- Does NOT use `honeycomb-grid` (overkill for this stage)

### `src/world/island-renderer.ts`

**Responsibility:** Render a `TileData[]` as Thin Instance hex tiles in a Babylon scene.

```typescript
export interface IslandHandle {
  mesh: Mesh;
  material: StandardMaterial;
}
export function renderIsland(scene: Scene, tiles: TileData[]): IslandHandle;
```

- Creates 1 source hex mesh: `CreateCylinder(tessellation=6, diameter=1.73, height=0.3)` — diameter = `sqrt(3)` for flat-top hex with size 1.0 (vertex-to-vertex across flat edge). Small visual gap (~0.01) between tiles is acceptable at this stage
- Creates 1 `StandardMaterial` internally with `hasVertexAlpha = true` (required for Thin Instance per-instance color to render)
- For each tile: computes world position via `axialToWorld`, builds a translation matrix, assigns a `Color4` based on terrain
- Color buffer: `Float32Array` of length `N * 4`, set via `thinInstanceSetBuffer("color", colorBuffer, 4)`
- Returns `{ mesh: Mesh; material: StandardMaterial }` so caller can dispose both without leaking

**Terrain color map (placeholder):**

| terrain | label | Color4 |
|---------|-------|--------|
| 0 | grass | `(0.56, 0.74, 0.34, 1)` |
| 1 | sand  | `(0.87, 0.82, 0.60, 1)` |
| 2 | rock  | `(0.58, 0.55, 0.52, 1)` |
| 3 | water | `(0.39, 0.62, 0.78, 1)` |

### `src/main.ts` (refactored)

**Responsibility:** Boot sequence only.

- Engine creation (WebGPU/WebGL2 fallback) — unchanged
- Camera, light, sea plane — kept
- Remove hardcoded `islandBase` / `islandCap` cylinders
- Call `generatePreview(DEFAULT_SEED_HI, DEFAULT_SEED_LO)` -> `renderIsland(scene, tiles)`
- Default seed: `0xDEADBEEF`, `0xCAFE0001` (hardcoded constant, future: URL hash)
- Update `render_game_to_text()` to include:
  - `seedHex`: hex string of the seed
  - `generator`: `"ts-fallback"` or `"wasm"`
  - `tileCount`: number of tiles
  - `tiles`: the tile array
- Remove spinning animation (no longer relevant with hex grid)
- Keep HUD (renderer, fps, meshes), fullscreen toggle, resize handler

## Decisions

1. **TS fallback as primary provider** — `wasm-pack` is not available in this environment. The bridge API is WASM-ready but the current implementation is pure TS. No optional WASM import in this commit to avoid Vite resolution issues with missing modules.

2. **Thin Instance with instance color (Approach A)** — 1 source mesh, 1 material, per-instance `Color4` buffer. Most performant path and directly extensible to 19+ tiles in Sprint 1.

3. **No honeycomb-grid** — The axial-to-world conversion is 2 lines. Adding a library dependency for this would be over-engineering.

4. **7-tile ring** — Matches the existing `generate_preview()` output in `lib.rs`. Sufficient for the vertical slice.

## Scope Exclusions

- KayKit asset loading / TileRegistry
- Full WFC solver (constraint propagation)
- FFT ocean / wave simulation
- Loro CRDT integration
- mistlib / WebRTC networking
- Havok physics
- Deep honeycomb-grid integration

## Implementation Order

1. `src/world/wfc-bridge.ts` (TileData type + TS fallback generator)
2. `src/world/hex-grid.ts` (pure function)
3. `src/world/island-renderer.ts` (Thin Instance rendering)
4. `src/main.ts` refactor (boot-only, wire everything together)
5. Verify: `npm run typecheck` + `npm run build`
