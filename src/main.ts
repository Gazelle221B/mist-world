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
import { generateIsland, initBridge } from "./world/wfc-bridge.ts";
import { type IslandHandle, renderIsland } from "./world/island-renderer.ts";
import { seedFromHash } from "./world/seed.ts";

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
  tileCount: number;
  voidCount: number;
  terrainCounts: number[];
  tiles: Array<{ q: number; r: number; terrain: number }>;
}

function mustQuerySelector<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const app = mustQuerySelector<HTMLDivElement>("#app");

app.innerHTML = `
  <div class="shell">
    <header class="masthead">
      <p class="eyebrow">Mist World / Sprint 0</p>
      <h1>Babylon + WASM bootstrap</h1>
      <p class="summary">Seeded island preview — hex grid vertical slice.</p>
    </header>
    <div class="viewport">
      <canvas id="render-canvas" aria-label="Mist World viewport"></canvas>
      <div class="hud">
        <span id="renderer-pill" class="pill">renderer: booting</span>
        <span id="fps-pill" class="pill">fps: --</span>
        <span id="mesh-pill" class="pill">meshes: --</span>
        <span id="seed-pill" class="pill pill--dim">seed: --</span>
        <span id="gen-pill" class="pill pill--dim">gen: --</span>
        <span id="void-pill" class="pill pill--dim" style="display:none">void: 0</span>
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
const voidPill = mustQuerySelector<HTMLSpanElement>("#void-pill");
const statusLine = mustQuerySelector<HTMLParagraphElement>("#status-line");

const state: RuntimeState = {
  renderer: "webgl2",
  sceneReady: false,
  meshCount: 0,
  fps: 0,
  cameraRadius: 0,
  seedHex: "",
  generator: "ts-fallback",
  tileCount: 0,
  voidCount: 0,
  terrainCounts: [0, 0, 0, 0],
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
    voidCount: state.voidCount,
    terrainCounts: state.terrainCounts,
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
    11,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 18;
  camera.wheelDeltaPercentage = 0.02;
  camera.attachControl(canvas, true);

  const light = new HemisphericLight("sun", new Vector3(0.15, 1, 0.1), scene);
  light.intensity = 1.1;

  const sea = MeshBuilder.CreateGround(
    "sea",
    {
      width: 22,
      height: 22,
      subdivisions: 2,
    },
    scene,
  );
  sea.position.y = -0.82;

  const seaMaterial = new StandardMaterial("sea-material", scene);
  seaMaterial.diffuseColor.set(0.39, 0.62, 0.68);
  seaMaterial.specularColor.set(0.18, 0.25, 0.28);
  seaMaterial.alpha = 0.96;
  sea.material = seaMaterial;

  await initBridge();

  state.renderer = renderer;
  state.sceneReady = true;

  let currentIsland: IslandHandle | null = null;

  function rebuildPreview() {
    const seed = seedFromHash();
    const preview = generateIsland(seed.hi, seed.lo);

    if (preview.seedHex === state.seedHex) return;

    if (currentIsland) {
      currentIsland.mesh.dispose();
      currentIsland.material.dispose();
      currentIsland = null;
    }

    currentIsland = renderIsland(scene, preview.tiles);

    state.seedHex = preview.seedHex;
    state.generator = preview.generator;
    state.tileCount = preview.tileCount;
    state.voidCount = preview.voidCount;
    state.terrainCounts = preview.terrainCounts;
    state.tiles = preview.tiles;

    seedPill.textContent = `seed: ${preview.seedHex}`;
    genPill.textContent = `gen: ${preview.generator}`;

    if (preview.voidCount > 0) {
      voidPill.textContent = `void: ${preview.voidCount}`;
      voidPill.style.display = "";
      voidPill.style.color = "#d32f2f";
      statusLine.textContent =
        `Warning: ${preview.voidCount} void tile(s) — WFC contradiction detected. seed ${preview.seedHex}`;
    } else {
      voidPill.style.display = "none";
      statusLine.textContent =
        `Preview: seed ${preview.seedHex} (${preview.generator}) — ${preview.tileCount} tiles. Drag to orbit, scroll to zoom.`;
    }
  }

  rebuildPreview();

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
    rebuildPreview();
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
