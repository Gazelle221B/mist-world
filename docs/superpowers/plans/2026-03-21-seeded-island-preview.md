# Seeded Island Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire seed → tile generation → Babylon hex grid rendering end-to-end as the Sprint 0 → Sprint 1 bridge.

**Architecture:** 4-module pipeline: `WfcBridge` (seed→tiles, TS fallback) → `hex-grid` (axial→world coords) → `IslandRenderer` (Thin Instance hex mesh) → `main.ts` (boot wiring). No WASM binary in this commit — bridge API is WASM-ready but uses a pure-TS provider.

**Tech Stack:** TypeScript 5.x, Babylon.js 8.x (Thin Instances, StandardMaterial), Vite 6.x

**Spec:** `docs/superpowers/specs/2026-03-21-seeded-island-preview-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/world/wfc-bridge.ts` | `TileData`/`PreviewResult` types + `generatePreview()` TS fallback |
| Create | `src/world/hex-grid.ts` | `axialToWorld()` pure function |
| Create | `src/world/island-renderer.ts` | `renderIsland()` Thin Instance hex renderer |
| Modify | `src/main.ts` | Refactor to boot-only, wire pipeline |

---

### Task 1: WFC Bridge (types + TS fallback generator)

**Files:**
- Create: `src/world/wfc-bridge.ts`

- [ ] **Step 1: Create `src/world/wfc-bridge.ts` with types and generator**

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Verify determinism manually**

Open a node/ts scratch or browser console and confirm:
- `generatePreview(0xDEADBEEF, 0xCAFE0001)` returns the same output on repeated calls
- `seedHex` is `"deadbeefcafe0001"`
- `tileCount` is `7`
- Each tile has `terrain` in range `[0, 3]`

- [ ] **Step 4: Commit**

```bash
git add src/world/wfc-bridge.ts
git commit -m "feat(world): add WFC bridge with TS fallback generator"
```

---

### Task 2: Hex Grid (axial → world coordinate conversion)

**Files:**
- Create: `src/world/hex-grid.ts`

- [ ] **Step 1: Create `src/world/hex-grid.ts`**

```typescript
const SQRT3 = Math.sqrt(3);

export function axialToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: 1.5 * q,
    z: (SQRT3 / 2) * q + SQRT3 * r,
  };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Spot-check coordinate values**

Expected values for the 7-tile ring (flat-top, size=1.0):
- `(0, 0)` → `{ x: 0, z: 0 }`
- `(1, 0)` → `{ x: 1.5, z: 0.866 }`
- `(-1, 1)` → `{ x: -1.5, z: 0.866 }`
- `(0, 1)` → `{ x: 0, z: 1.732 }`

Verify these mentally or in console. The center tile should be at origin, ring tiles at distance ~1.73 from center.

- [ ] **Step 4: Commit**

```bash
git add src/world/hex-grid.ts
git commit -m "feat(world): add axial-to-world hex coordinate conversion"
```

---

### Task 3: Island Renderer (Thin Instance hex tiles)

**Files:**
- Create: `src/world/island-renderer.ts`
- Reference: `src/world/wfc-bridge.ts` (TileData type), `src/world/hex-grid.ts` (axialToWorld)

- [ ] **Step 1: Create `src/world/island-renderer.ts`**

```typescript
import {
  Color3,
  Color4,
  Matrix,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
} from "@babylonjs/core";
import type { TileData } from "./wfc-bridge.ts";
import { axialToWorld } from "./hex-grid.ts";

export interface IslandHandle {
  mesh: Mesh;
  material: StandardMaterial;
}

const TERRAIN_COLORS: readonly Color4[] = [
  new Color4(0.56, 0.74, 0.34, 1), // 0: grass
  new Color4(0.87, 0.82, 0.60, 1), // 1: sand
  new Color4(0.58, 0.55, 0.52, 1), // 2: rock
  new Color4(0.39, 0.62, 0.78, 1), // 3: water
];

export function renderIsland(scene: Scene, tiles: TileData[]): IslandHandle {
  const material = new StandardMaterial("hex-terrain", scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.1, 0.1, 0.1);
  material.hasVertexAlpha = true; // Required for thin instance per-instance color

  const source = MeshBuilder.CreateCylinder(
    "hex-source",
    { tessellation: 6, diameter: 1.73, height: 0.3 },
    scene,
  );
  source.material = material;
  source.rotation.y = Math.PI / 6;

  const matrices: Matrix[] = [];
  const colorData = new Float32Array(tiles.length * 4);

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const { x, z } = axialToWorld(tile.q, tile.r);
    matrices.push(Matrix.Translation(x, 0, z));

    const color = TERRAIN_COLORS[tile.terrain] ?? TERRAIN_COLORS[0];
    colorData[i * 4 + 0] = color.r;
    colorData[i * 4 + 1] = color.g;
    colorData[i * 4 + 2] = color.b;
    colorData[i * 4 + 3] = color.a;
  }

  for (const matrix of matrices) {
    source.thinInstanceAdd(matrix);
  }
  source.thinInstanceSetBuffer("color", colorData, 4);

  return { mesh: source, material };
}
```

**Key Babylon.js notes:**
- `rotation.y = Math.PI / 6` rotates the cylinder so flat edges face the hex grid directions
- `thinInstanceSetBuffer("color", ..., 4)` requires the material's vertex color support. Babylon's `StandardMaterial` reads thin instance color automatically when the buffer is named `"color"`
- If per-instance colors don't render (all tiles same color), the fallback is to set `material.hasVertexAlpha = true` — add this only if needed during visual verification

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/world/island-renderer.ts
git commit -m "feat(world): add Thin Instance hex island renderer"
```

---

### Task 4: Refactor `main.ts` to boot-only

**Files:**
- Modify: `src/main.ts`

This is the largest task. The existing `main.ts` has hardcoded cylinder geometry (islandBase, islandCap) and a spinning animation. We replace those with the pipeline: `generatePreview` → `renderIsland`.

- [ ] **Step 1: Add imports and seed constants at top of `main.ts`**

After the existing Babylon imports, add:

```typescript
import { generatePreview } from "./world/wfc-bridge.ts";
import { renderIsland } from "./world/island-renderer.ts";
```

Add seed constants before the `app` declaration:

```typescript
const DEFAULT_SEED_HI = 0xdeadbeef;
const DEFAULT_SEED_LO = 0xcafe0001;
```

- [ ] **Step 2: Update `RuntimeState` and `renderGameToText`**

Add to the `RuntimeState` interface:

```typescript
interface RuntimeState {
  renderer: RendererKind;
  sceneReady: boolean;
  meshCount: number;
  fps: number;
  cameraRadius: number;
  seedHex: string;
  generator: "wasm" | "ts-fallback";
  tileCount: number;
  tiles: Array<{ q: number; r: number; terrain: number }>;
}
```

Update initial state to include:

```typescript
const state: RuntimeState = {
  renderer: "webgl2",
  sceneReady: false,
  meshCount: 0,
  fps: 0,
  cameraRadius: 0,
  seedHex: "",
  generator: "ts-fallback",
  tileCount: 0,
  tiles: [],
};
```

Replace the `renderGameToText` function (note: the `coordinateSystem` field from the Sprint 0 bootstrap is intentionally removed — it is not part of the preview pipeline):

```typescript
function renderGameToText() {
  return JSON.stringify({
    mode: "preview",
    renderer: state.renderer,
    sceneReady: state.sceneReady,
    meshCount: state.meshCount,
    fps: Number(state.fps.toFixed(1)),
    cameraRadius: Number(state.cameraRadius.toFixed(2)),
    seedHex: state.seedHex,
    generator: state.generator,
    tileCount: state.tileCount,
    tiles: state.tiles,
  });
}
```

- [ ] **Step 3: Replace island geometry with hex grid pipeline in `bootstrap()`**

Remove these blocks from `bootstrap()`:
- The `islandBase` cylinder (lines 145-156 in original)
- The `islandCap` cylinder (lines 157-167)
- The `terrainMaterial` and its assignments (lines 180-184)
- The `simulatedSpin` variable and the spin logic inside `step()` (lines 198-203)

Replace with the pipeline call, placed after the sea plane and seaMaterial setup:

```typescript
  const preview = generatePreview(DEFAULT_SEED_HI, DEFAULT_SEED_LO);
  const island = renderIsland(scene, preview.tiles);

  state.seedHex = preview.seedHex;
  state.generator = preview.generator;
  state.tileCount = preview.tileCount;
  state.tiles = preview.tiles;
```

- [ ] **Step 4: Simplify the render loop `step()` function**

The `step` function no longer needs spin animation. Replace it with:

```typescript
  const step = () => {
    state.meshCount = scene.meshes.length;
    state.fps = engine.getFps();
    state.cameraRadius = camera.radius;
    updateHud();
  };

  engine.runRenderLoop(() => {
    step();
    scene.render();
  });
```

Remove `window.advanceTime` assignment AND remove `advanceTime` from the `declare global` `Window` interface (dead declaration cleanup):

```typescript
declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}
```

```typescript
  window.render_game_to_text = renderGameToText;
```

- [ ] **Step 5: Update status line text**

Change the status line from:
```
"Engine ready. Drag to orbit, scroll to zoom, and press F to toggle fullscreen."
```
to:
```
`Preview: seed ${preview.seedHex} (${preview.generator}) — ${preview.tileCount} tiles. Drag to orbit, scroll to zoom.`
```

- [ ] **Step 6: Update HTML masthead to reflect new stage**

Change the summary text in `app.innerHTML`:
```html
<p class="summary">Seeded island preview — hex grid vertical slice.</p>
```

- [ ] **Step 7: Remove unused imports**

After removing islandBase/islandCap cylinders and terrainMaterial, check if `StandardMaterial` and `Color4` are still used in `main.ts`. They should no longer be needed (they moved to `island-renderer.ts`). Remove unused imports.

The remaining Babylon imports in `main.ts` should be:
```typescript
import {
  ArcRotateCamera,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
  WebGPUEngine,
} from "@babylonjs/core";
```

Wait — `Color4` is still used for `scene.clearColor`, `MeshBuilder` for the sea plane, and `StandardMaterial` is needed for `seaMaterial`. Check carefully:
- `Color4` — yes, used in `scene.clearColor = new Color4(...)`
- `StandardMaterial` — yes, used for `seaMaterial`
- `MeshBuilder` — yes, used for the sea `CreateGround`

So the imports become:
```typescript
import {
  ArcRotateCamera,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  WebGPUEngine,
} from "@babylonjs/core";
```

No import removal needed — all original imports are still used. Just confirm none are dangling.

- [ ] **Step 8: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Verify build passes**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 10: Commit**

```bash
git add src/main.ts
git commit -m "refactor(main): wire seeded island preview pipeline, boot-only main"
```

---

### Task 5: Visual Verification + Final Commit

**Files:** none (verification only)

- [ ] **Step 1: Run dev server and visually verify**

Run: `npm run dev`

Open browser. Expected:
- 7 hexagonal tiles arranged in a ring pattern (1 center + 6 surrounding)
- Each tile has one of 4 colors (grass/sand/rock/water)
- Sea plane visible beneath the hex tiles
- HUD shows renderer type, FPS, mesh count
- Drag to orbit works, scroll to zoom works

- [ ] **Step 2: Verify determinism via `render_game_to_text()`**

In browser console:
```javascript
JSON.parse(window.render_game_to_text())
```

Expected output includes:
- `mode: "preview"`
- `seedHex: "deadbeefcafe0001"`
- `generator: "ts-fallback"`
- `tileCount: 7`
- `tiles`: array of 7 objects with `q`, `r`, `terrain` fields

Reload page and run again — output must be identical.

- [ ] **Step 3: Check both renderers produce same tiles**

The tile arrangement (from `render_game_to_text()`) must be identical regardless of WebGPU vs WebGL2. The `tiles` array is renderer-independent (generated before rendering), so this should be automatic. Verify by comparing `tiles` field across renders.

- [ ] **Step 4: If per-instance colors are not rendering**

If all tiles appear the same color (white or single color), add `material.hasVertexAlpha = true` to `island-renderer.ts` after creating the material. This is the known Babylon Thin Instance color buffer requirement.

Re-run typecheck and build after any fix.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -u
git commit -m "fix(world): adjust island renderer for visual correctness"
```
