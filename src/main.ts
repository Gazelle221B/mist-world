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
import { initBridge } from "./world/wfc-bridge.ts";
import {
  type IslandHandle,
  type PlaceholderHandle,
  renderIsland,
  renderPlaceholders,
} from "./world/island-renderer.ts";
import { radiusFromQuery, seedFromHash } from "./world/seed.ts";
import { terrainCountsByName } from "./world/terrain.ts";
import { HexWorld } from "./world/hex-world.ts";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    expand_region?: (macroQ: number, macroR: number) => void;
  }
}

type RendererKind = "webgpu" | "webgl2";
type InteractionMode = "move" | "build";

interface RuntimeState {
  renderer: RendererKind;
  sceneReady: boolean;
  meshCount: number;
  fps: number;
  cameraRadius: number;
  seedHex: string;
  generator: "wasm" | "ts-fallback";
  radius: number;
  mode: InteractionMode;
  regionCount: number;
  frontierCount: number;
  totalTileCount: number;
  voidCount: number;
  boundaryFixCount: number;
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
      <p class="summary">Expandable hex world — click placeholders to grow.</p>
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
        <span id="mode-pill" class="pill pill--dim">mode: move</span>
        <span id="region-pill" class="pill pill--dim">regions: 0</span>
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
const modePill = mustQuerySelector<HTMLSpanElement>("#mode-pill");
const regionPill = mustQuerySelector<HTMLSpanElement>("#region-pill");
const statusLine = mustQuerySelector<HTMLParagraphElement>("#status-line");

const state: RuntimeState = {
  renderer: "webgl2",
  sceneReady: false,
  meshCount: 0,
  fps: 0,
  cameraRadius: 0,
  seedHex: "",
  generator: "ts-fallback",
  radius: 2,
  mode: "move",
  regionCount: 0,
  frontierCount: 0,
  totalTileCount: 0,
  voidCount: 0,
  boundaryFixCount: 0,
  terrainCounts: [0, 0, 0, 0, 0, 0],
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
  modePill.textContent = `mode: ${state.mode}`;
  regionPill.textContent = `regions: ${state.regionCount}`;
}

function renderGameToText() {
  return JSON.stringify({
    mode: state.mode,
    renderer: state.renderer,
    sceneReady: state.sceneReady,
    meshCount: state.meshCount,
    fps: Number(state.fps.toFixed(1)),
    cameraRadius: Number(state.cameraRadius.toFixed(2)),
    seedHex: state.seedHex,
    generator: state.generator,
    radius: state.radius,
    regionCount: state.regionCount,
    frontierCount: state.frontierCount,
    totalTileCount: state.totalTileCount,
    voidCount: state.voidCount,
    boundaryFixCount: state.boundaryFixCount,
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
  // World state
  // -----------------------------------------------------------------------

  const seed = seedFromHash();
  const radius = radiusFromQuery();
  state.radius = radius;
  state.seedHex = `${(seed.hi >>> 0).toString(16).padStart(8, "0")}${(seed.lo >>> 0).toString(16).padStart(8, "0")}`;

  const world = new HexWorld(radius, seed.hi, seed.lo);
  world.init();

  // Track rendered regions and placeholders
  const regionHandles = new Map<string, IslandHandle>();
  let placeholderHandle: PlaceholderHandle | null = null;

  function rkey(q: number, r: number): string {
    return `${q},${r}`;
  }

  /** Aggregate terrain stats from all populated regions. */
  function updateWorldStats() {
    const counts = [0, 0, 0, 0, 0, 0];
    let total = 0;
    let voids = 0;

    for (const region of world.populatedRegions()) {
      if (!region.tiles) continue;
      for (const tile of region.tiles) {
        total++;
        if (tile.terrain === 255) {
          voids++;
        } else {
          counts[tile.terrain]++;
        }
      }
    }

    state.regionCount = world.populatedCount();
    state.frontierCount = world.placeholders().length;
    state.totalTileCount = total;
    state.voidCount = voids;
    state.boundaryFixCount = world.totalBoundaryFixes();
    state.terrainCounts = counts;
  }

  /** Render all populated regions that haven't been rendered yet. */
  async function renderNewRegions(animate: boolean = false) {
    for (const region of world.populatedRegions()) {
      const key = rkey(region.macroQ, region.macroR);
      if (regionHandles.has(key) || !region.tiles) continue;

      const handle = await renderIsland(
        scene,
        region.tiles,
        region.macroQ,
        region.macroR,
        world.spacing,
        animate,
      );
      regionHandles.set(key, handle);
    }
  }

  /** Rebuild placeholder visuals. */
  function rebuildPlaceholders() {
    if (placeholderHandle) {
      placeholderHandle.dispose();
      placeholderHandle = null;
    }

    const phs = world.placeholders();
    if (phs.length > 0) {
      placeholderHandle = renderPlaceholders(scene, phs, world.spacing);
    }
  }

  /** Full rebuild: dispose all, regenerate from world state. */
  async function fullRebuild() {
    for (const handle of regionHandles.values()) handle.dispose();
    regionHandles.clear();
    if (placeholderHandle) {
      placeholderHandle.dispose();
      placeholderHandle = null;
    }

    await renderNewRegions();
    rebuildPlaceholders();
    updateWorldStats();
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
        `${state.regionCount} region(s), ${state.totalTileCount} tiles. ` +
        `[B] toggle build mode. Click placeholder to expand.`;
    }
  }

  // Initial render
  await fullRebuild();

  // -----------------------------------------------------------------------
  // Interaction: Build mode + placeholder clicking
  // -----------------------------------------------------------------------

  let expanding = false;

  async function expandAt(macroQ: number, macroR: number) {
    if (expanding) return; // prevent double-click during animation
    expanding = true;
    statusLine.textContent = `Building region (${macroQ}, ${macroR})...`;

    const ok = world.expand(macroQ, macroR);
    if (!ok) {
      statusLine.textContent = `Cannot expand at (${macroQ}, ${macroR}).`;
      expanding = false;
      return;
    }

    await renderNewRegions(true);
    rebuildPlaceholders();
    updateWorldStats();
    updateStatusLine();
    expanding = false;
  }

  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== 1) return; // POINTERDOWN = 1
    if (state.mode !== "build") return;
    if (expanding) return; // guard against clicks during expand

    const pickResult = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (mesh) => mesh.metadata?.macroQ !== undefined,
    );
    if (!pickResult?.hit || !pickResult.pickedMesh) return;

    const meta = pickResult.pickedMesh.metadata as {
      macroQ: number;
      macroR: number;
    };
    expandAt(meta.macroQ, meta.macroR);
  });

  window.expand_region = (macroQ: number, macroR: number) => {
    if (expanding) return;
    expandAt(macroQ, macroR);
  };

  // -----------------------------------------------------------------------
  // Render loop + keyboard
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

  window.addEventListener("hashchange", () => {
    const newSeed = seedFromHash();
    const newRadius = radiusFromQuery();
    const hex = `${(newSeed.hi >>> 0).toString(16).padStart(8, "0")}${(newSeed.lo >>> 0).toString(16).padStart(8, "0")}`;

    if (hex === state.seedHex && newRadius === state.radius) return;

    state.seedHex = hex;
    state.radius = newRadius;
    world.reset(newSeed.hi, newSeed.lo);
    fullRebuild();
  });

  window.addEventListener("keydown", async (event) => {
    const key = event.key.toLowerCase();

    if (key === "b") {
      state.mode = state.mode === "move" ? "build" : "move";
      modePill.textContent = `mode: ${state.mode}`;
      // Visual feedback: show/hide placeholder edges
      canvas.style.cursor = state.mode === "build" ? "crosshair" : "default";
    }

    if (key === "f") {
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
