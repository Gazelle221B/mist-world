import "./style.css";

import {
  type AbstractMesh,
  ArcRotateCamera,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  Vector3,
  WebGPUEngine,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { HexWorld } from "./world/hex-world.ts";
import { initBridge } from "./world/wfc-bridge.ts";
import {
  type IslandHandle,
  type PlaceholderHandle,
  renderPlaceholders,
  renderWorld,
} from "./world/island-renderer.ts";
import { radiusFromQuery, seedFromHash } from "./world/seed.ts";
import {
  TERRAIN_COUNT,
  terrainCountsByName,
} from "./world/terrain.ts";

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

type RendererKind = "webgpu" | "webgl2";

interface RuntimeTileSnapshot {
  q: number;
  r: number;
  terrain: number;
  prototypeId: number;
  rotation: number;
  collapseOrder: number;
}

interface RuntimeState {
  renderer: RendererKind;
  sceneReady: boolean;
  meshCount: number;
  fps: number;
  cameraRadius: number;
  seedHex: string;
  generator: "wasm" | "ts-fallback";
  radius: number;
  populatedRegionCount: number;
  placeholderCount: number;
  globalTileCount: number;
  voidCount: number;
  boundaryFixCount: number;
  terrainCounts: number[];
  tiles: RuntimeTileSnapshot[];
}

interface PlaceholderMetadata {
  macroQ: number;
  macroR: number;
}

function mustQuerySelector<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const app = mustQuerySelector<HTMLDivElement>("#app");

app.innerHTML = `
  <div class="shell">
    <header class="masthead">
      <p class="eyebrow">Mist World / Sprint 0</p>
      <h1>Babylon + WASM bootstrap</h1>
      <p class="summary">Expandable hex-world visual slice.</p>
    </header>
    <div class="viewport">
      <canvas id="render-canvas" aria-label="Mist World viewport"></canvas>
      <div class="hud">
        <span id="renderer-pill" class="pill">renderer: booting</span>
        <span id="fps-pill" class="pill">fps: --</span>
        <span id="mesh-pill" class="pill">meshes: --</span>
        <span id="seed-pill" class="pill pill--dim">seed: --</span>
        <span id="gen-pill" class="pill pill--dim">gen: --</span>
        <span id="radius-pill" class="pill pill--dim">r: --</span>
      </div>
    </div>
    <p id="status-line" class="status-line">Preparing engine bootstrap...</p>
  </div>
`;

const canvas = mustQuerySelector<HTMLCanvasElement>("#render-canvas");
const rendererPill = mustQuerySelector<HTMLSpanElement>("#renderer-pill");
const fpsPill = mustQuerySelector<HTMLSpanElement>("#fps-pill");
const meshPill = mustQuerySelector<HTMLSpanElement>("#mesh-pill");
const seedPill = mustQuerySelector<HTMLSpanElement>("#seed-pill");
const genPill = mustQuerySelector<HTMLSpanElement>("#gen-pill");
const radiusPill = mustQuerySelector<HTMLSpanElement>("#radius-pill");
const statusLine = mustQuerySelector<HTMLParagraphElement>("#status-line");

const state: RuntimeState = {
  renderer: "webgl2",
  sceneReady: false,
  meshCount: 0,
  fps: 0,
  cameraRadius: 0,
  seedHex: "",
  generator: "ts-fallback",
  radius: radiusFromQuery(),
  populatedRegionCount: 0,
  placeholderCount: 0,
  globalTileCount: 0,
  voidCount: 0,
  boundaryFixCount: 0,
  terrainCounts: Array(TERRAIN_COUNT).fill(0),
  tiles: [],
};

async function createEngine(target: HTMLCanvasElement) {
  const canUseWebGPU = "gpu" in navigator && (await WebGPUEngine.IsSupportedAsync);

  if (canUseWebGPU) {
    try {
      const engine = await WebGPUEngine.CreateAsync(target, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      return { engine, renderer: "webgpu" as const };
    } catch (error) {
      console.warn("WebGPU init failed, falling back to WebGL2", error);
    }
  }

  const engine = new Engine(target, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    disableWebGL2Support: false,
    adaptToDeviceRatio: true,
  });

  return { engine, renderer: "webgl2" as const };
}

function updateHud() {
  rendererPill.textContent = `renderer: ${state.renderer}`;
  fpsPill.textContent = `fps: ${state.fps.toFixed(1)}`;
  meshPill.textContent = `meshes: ${state.meshCount}`;
}

function seedToHex(seedHi: number, seedLo: number): string {
  const hi = (seedHi >>> 0).toString(16).padStart(8, "0");
  const lo = (seedLo >>> 0).toString(16).padStart(8, "0");
  return hi + lo;
}

function compareTileSnapshots(a: RuntimeTileSnapshot, b: RuntimeTileSnapshot): number {
  return a.q - b.q ||
    a.r - b.r ||
    a.collapseOrder - b.collapseOrder ||
    a.prototypeId - b.prototypeId;
}

function countTerrains(tiles: RuntimeTileSnapshot[]): number[] {
  const counts = Array(TERRAIN_COUNT).fill(0);
  for (const tile of tiles) {
    if (tile.terrain < 0 || tile.terrain >= TERRAIN_COUNT) continue;
    counts[tile.terrain] += 1;
  }
  return counts;
}

function syncWorldState(world: HexWorld) {
  const tiles = world
    .allTiles()
    .map((tile) => ({
      q: tile.q,
      r: tile.r,
      terrain: tile.terrain,
      prototypeId: tile.prototypeId,
      rotation: tile.rotation,
      collapseOrder: tile.collapseOrder,
    }))
    .sort(compareTileSnapshots);

  state.populatedRegionCount = world.populatedCount();
  state.placeholderCount = world.placeholders().length;
  state.globalTileCount = world.globalTileCount();
  state.voidCount = world.totalVoidCount();
  state.boundaryFixCount = world.totalBoundaryFixes();
  state.terrainCounts = countTerrains(tiles);
  state.tiles = tiles;
}

function readPlaceholderMetadata(
  mesh: AbstractMesh | null | undefined,
): PlaceholderMetadata | null {
  const metadata = mesh?.metadata;
  if (!metadata || typeof metadata !== "object") return null;

  const placeholder = metadata as Partial<PlaceholderMetadata>;
  if (
    typeof placeholder.macroQ !== "number" ||
    typeof placeholder.macroR !== "number"
  ) {
    return null;
  }

  return {
    macroQ: placeholder.macroQ,
    macroR: placeholder.macroR,
  };
}

function renderGameToText() {
  return JSON.stringify({
    renderer: state.renderer,
    sceneReady: state.sceneReady,
    meshCount: state.meshCount,
    fps: Number(state.fps.toFixed(1)),
    cameraRadius: Number(state.cameraRadius.toFixed(2)),
    seedHex: state.seedHex,
    generator: state.generator,
    radius: state.radius,
    populatedRegionCount: state.populatedRegionCount,
    placeholderCount: state.placeholderCount,
    globalTileCount: state.globalTileCount,
    voidCount: state.voidCount,
    boundaryFixCount: state.boundaryFixCount,
    terrainCounts: state.terrainCounts,
    terrainCountsByName: terrainCountsByName(state.terrainCounts),
    tiles: state.tiles,
  });
}

async function bootstrap() {
  const { engine, renderer } = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.81, 0.88, 0.88, 1);

  const camera = new ArcRotateCamera(
    "orbit-camera",
    Math.PI / 3,
    1.1,
    14,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 40;
  camera.wheelDeltaPercentage = 0.02;
  camera.attachControl(canvas, true);

  const light = new HemisphericLight("sun", new Vector3(0.15, 1, 0.1), scene);
  light.intensity = 1.1;

  const sea = MeshBuilder.CreateGround(
    "sea",
    { width: 60, height: 60, subdivisions: 2 },
    scene,
  );
  sea.position.y = -0.82;
  sea.isPickable = false;

  const seaMaterial = new StandardMaterial("sea-material", scene);
  seaMaterial.diffuseColor.set(0.39, 0.62, 0.68);
  seaMaterial.specularColor.set(0.18, 0.25, 0.28);
  seaMaterial.alpha = 0.96;
  sea.material = seaMaterial;

  const genKind = await initBridge();

  state.renderer = renderer;
  state.sceneReady = true;
  state.generator = genKind;

  let world: HexWorld | null = null;
  let baseWorldHandle: IslandHandle | null = null;
  let placeholderHandle: PlaceholderHandle | null = null;
  let expansionHandles: IslandHandle[] = [];
  let renderEpoch = 0;
  let rebuildingEpoch: number | null = null;
  let expandingRegionKey: string | null = null;

  function disposeWorldHandles() {
    placeholderHandle?.dispose();
    placeholderHandle = null;

    baseWorldHandle?.dispose();
    baseWorldHandle = null;

    for (const handle of expansionHandles) {
      handle.dispose();
    }
    expansionHandles = [];
  }

  function updateStatusLine() {
    seedPill.textContent = `seed: ${state.seedHex}`;
    genPill.textContent = `gen: ${state.generator}`;
    radiusPill.textContent = `r: ${state.radius}`;

    if (rebuildingEpoch !== null) {
      statusLine.textContent = "Regenerating world...";
      return;
    }

    if (state.voidCount > 0) {
      statusLine.textContent =
        `Warning: ${state.voidCount} void tile(s) — WFC contradiction.`;
      return;
    }

    if (expandingRegionKey !== null) {
      statusLine.textContent =
        `Expanding region ${expandingRegionKey}... ${state.populatedRegionCount} regions / ${state.placeholderCount} placeholders`;
      return;
    }

    statusLine.textContent =
      `Click pale hex markers to expand. ${state.populatedRegionCount} regions / ${state.placeholderCount} placeholders`;
  }

  async function rebuildWorld(seedHi: number, seedLo: number, radius: number) {
    const epoch = ++renderEpoch;
    rebuildingEpoch = epoch;
    expandingRegionKey = null;
    updateStatusLine();

    const nextWorld = new HexWorld(radius, seedHi, seedLo);
    nextWorld.init();

    const nextBaseHandle = await renderWorld(scene, nextWorld.allTiles(), false);
    if (epoch !== renderEpoch) {
      nextBaseHandle.dispose();
      return;
    }

    const nextPlaceholderHandle = renderPlaceholders(
      scene,
      nextWorld.placeholders(),
      nextWorld.spacing,
    );
    if (epoch !== renderEpoch) {
      nextBaseHandle.dispose();
      nextPlaceholderHandle.dispose();
      return;
    }

    const previousBaseHandle = baseWorldHandle;
    const previousPlaceholderHandle = placeholderHandle;
    const previousExpansionHandles = expansionHandles;

    world = nextWorld;
    baseWorldHandle = nextBaseHandle;
    placeholderHandle = nextPlaceholderHandle;
    expansionHandles = [];

    state.seedHex = seedToHex(seedHi, seedLo);
    state.radius = radius;
    syncWorldState(nextWorld);

    previousPlaceholderHandle?.dispose();
    previousBaseHandle?.dispose();
    for (const handle of previousExpansionHandles) {
      handle.dispose();
    }

    if (rebuildingEpoch === epoch) {
      rebuildingEpoch = null;
    }
    updateStatusLine();
  }

  async function expandPlaceholder(macroQ: number, macroR: number) {
    if (!world || rebuildingEpoch !== null || expandingRegionKey !== null) {
      return;
    }

    const currentWorld = world;
    const regionKey = `${macroQ},${macroR}`;
    const epoch = renderEpoch;

    expandingRegionKey = regionKey;
    updateStatusLine();

    const newTiles = currentWorld.expand(macroQ, macroR);
    const expansionHandle = newTiles.length > 0
      ? await renderWorld(scene, newTiles, true)
      : null;

    if (epoch !== renderEpoch || world !== currentWorld) {
      expansionHandle?.dispose();
      if (expandingRegionKey === regionKey) {
        expandingRegionKey = null;
      }
      return;
    }

    const previousPlaceholderHandle = placeholderHandle;
    const nextPlaceholderHandle = renderPlaceholders(
      scene,
      currentWorld.placeholders(),
      currentWorld.spacing,
    );

    if (epoch !== renderEpoch || world !== currentWorld) {
      expansionHandle?.dispose();
      nextPlaceholderHandle.dispose();
      if (expandingRegionKey === regionKey) {
        expandingRegionKey = null;
      }
      return;
    }

    placeholderHandle = nextPlaceholderHandle;
    previousPlaceholderHandle?.dispose();

    if (expansionHandle) {
      expansionHandles.push(expansionHandle);
    }

    syncWorldState(currentWorld);
    expandingRegionKey = null;
    updateStatusLine();
  }

  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERPICK) return;

    const placeholder = readPlaceholderMetadata(pointerInfo.pickInfo?.pickedMesh);
    if (!placeholder) return;

    void expandPlaceholder(placeholder.macroQ, placeholder.macroR).catch(
      (error: unknown) => {
        console.error(error);
        expandingRegionKey = null;
        statusLine.textContent =
          "Region expansion failed. Check the console for details.";
      },
    );
  });

  const seed = seedFromHash();
  await rebuildWorld(seed.hi, seed.lo, radiusFromQuery());

  // -----------------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------------

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

  window.render_game_to_text = renderGameToText;

  window.addEventListener("hashchange", async () => {
    try {
      const newSeed = seedFromHash();
      const newRadius = radiusFromQuery();
      const hex = seedToHex(newSeed.hi, newSeed.lo);

      if (hex === state.seedHex && newRadius === state.radius) return;

      await rebuildWorld(newSeed.hi, newSeed.lo, newRadius);
    } catch (error) {
      console.error(error);
      rebuildingEpoch = null;
      expandingRegionKey = null;
      statusLine.textContent = "World redraw failed. Check the console for details.";
    }
  });

  window.addEventListener("keydown", async (event) => {
    if (event.key.toLowerCase() === "f") {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await canvas.requestFullscreen();
      }
    }
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });

  window.addEventListener("beforeunload", () => {
    disposeWorldHandles();
  });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  statusLine.textContent = "Bootstrap failed. Check the console for details.";
});
