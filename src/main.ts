import "./style.css";

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
import "@babylonjs/loaders/glTF";
import { initBridge, generateIsland } from "./world/wfc-bridge.ts";
import {
  type IslandHandle,
  renderIsland as renderIslandMeshes,
} from "./world/island-renderer.ts";
import { radiusFromQuery, seedFromHash } from "./world/seed.ts";
import {
  TERRAIN_COUNT,
  TERRAIN_VOID_ID,
  terrainCountsByName,
} from "./world/terrain.ts";

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

type RendererKind = "webgpu" | "webgl2";

interface RuntimeState {
  renderer: RendererKind;
  sceneReady: boolean;
  meshCount: number;
  fps: number;
  cameraRadius: number;
  seedHex: string;
  generator: "wasm" | "ts-fallback";
  radius: number;
  totalTileCount: number;
  voidCount: number;
  terrainCounts: number[];
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
      <p class="summary">Single-island visual slice.</p>
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
  totalTileCount: 0,
  voidCount: 0,
  terrainCounts: Array(TERRAIN_COUNT).fill(0),
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
    tileCount: state.totalTileCount,
    voidCount: state.voidCount,
    terrainCounts: state.terrainCounts,
    terrainCountsByName: terrainCountsByName(state.terrainCounts),
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

  // -----------------------------------------------------------------------
  // Single-island generation
  // -----------------------------------------------------------------------

  const seed = seedFromHash();
  state.radius = radiusFromQuery();
  state.seedHex = `${(seed.hi >>> 0).toString(16).padStart(8, "0")}${(seed.lo >>> 0).toString(16).padStart(8, "0")}`;

  let currentHandle: IslandHandle | null = null;
  let renderEpoch = 0;

  async function renderIsland(seedHi: number, seedLo: number, r: number) {
    const epoch = ++renderEpoch;
    const previousHandle = currentHandle;

    const result = generateIsland(seedHi, seedLo, r);

    state.totalTileCount = result.tileCount;
    state.voidCount = result.voidCount;
    state.terrainCounts = result.terrainCounts;

    const visibleTiles = result.tiles.filter(
      (t) => t.terrain !== TERRAIN_VOID_ID,
    );
    const handle = await renderIslandMeshes(scene, visibleTiles);

    // Discard if a newer render started while we awaited
    if (epoch !== renderEpoch) {
      handle.dispose();
      return;
    }

    currentHandle = handle;
    previousHandle?.dispose();
    updateStatusLine();
  }

  function updateStatusLine() {
    seedPill.textContent = `seed: ${state.seedHex}`;
    genPill.textContent = `gen: ${state.generator}`;
    radiusPill.textContent = `r: ${state.radius}`;

    if (state.voidCount > 0) {
      statusLine.textContent =
        `Warning: ${state.voidCount} void tile(s) — WFC contradiction. seed ${state.seedHex}`;
    } else {
      statusLine.textContent =
        `${state.totalTileCount} tiles. seed ${state.seedHex}`;
    }
  }

  // Initial render
  await renderIsland(seed.hi, seed.lo, state.radius);

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
      const hex = `${(newSeed.hi >>> 0).toString(16).padStart(8, "0")}${(newSeed.lo >>> 0).toString(16).padStart(8, "0")}`;

      if (hex === state.seedHex && newRadius === state.radius) return;

      await renderIsland(newSeed.hi, newSeed.lo, newRadius);
      state.seedHex = hex;
      state.radius = newRadius;
      updateStatusLine();
    } catch (error) {
      console.error(error);
      statusLine.textContent = "Island redraw failed. Check the console for details.";
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
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  statusLine.textContent = "Bootstrap failed. Check the console for details.";
});
