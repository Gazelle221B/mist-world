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

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

type RendererKind = "webgpu" | "webgl2";

interface RuntimeState {
  renderer: RendererKind;
  sceneReady: boolean;
  meshCount: number;
  fps: number;
  cameraRadius: number;
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
      <p class="summary">WebGPU-first scene startup with WebGL2 fallback, ready for Rust/WASM modules.</p>
    </header>
    <div class="viewport">
      <canvas id="render-canvas" aria-label="Mist World viewport"></canvas>
      <div class="hud">
        <span id="renderer-pill" class="pill">renderer: booting</span>
        <span id="fps-pill" class="pill">fps: --</span>
        <span id="mesh-pill" class="pill">meshes: --</span>
      </div>
    </div>
    <p id="status-line" class="status-line">Preparing engine bootstrap...</p>
  </div>
`;

const canvas = mustQuerySelector<HTMLCanvasElement>("#render-canvas");
const rendererPill = mustQuerySelector<HTMLSpanElement>("#renderer-pill");
const fpsPill = mustQuerySelector<HTMLSpanElement>("#fps-pill");
const meshPill = mustQuerySelector<HTMLSpanElement>("#mesh-pill");
const statusLine = mustQuerySelector<HTMLParagraphElement>("#status-line");

const state: RuntimeState = {
  renderer: "webgl2",
  sceneReady: false,
  meshCount: 0,
  fps: 0,
  cameraRadius: 0,
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
    mode: "bootstrap",
    renderer: state.renderer,
    sceneReady: state.sceneReady,
    meshCount: state.meshCount,
    fps: Number(state.fps.toFixed(1)),
    cameraRadius: Number(state.cameraRadius.toFixed(2)),
    coordinateSystem: {
      origin: "world center",
      x: "east",
      y: "up",
      z: "south",
    },
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

  const islandBase = MeshBuilder.CreateCylinder(
    "island-base",
    {
      diameter: 5.4,
      height: 0.8,
      tessellation: 6,
    },
    scene,
  );
  islandBase.position.y = -0.4;
  islandBase.rotation.y = Math.PI / 6;

  const islandCap = MeshBuilder.CreateCylinder(
    "island-cap",
    {
      diameter: 5,
      height: 0.32,
      tessellation: 6,
    },
    scene,
  );
  islandCap.position.y = 0.16;
  islandCap.rotation.y = Math.PI / 6;

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

  const terrainMaterial = new StandardMaterial("terrain-material", scene);
  terrainMaterial.diffuseColor.set(0.56, 0.68, 0.46);
  terrainMaterial.specularColor.set(0.07, 0.08, 0.06);
  islandBase.material = terrainMaterial;
  islandCap.material = terrainMaterial;

  const seaMaterial = new StandardMaterial("sea-material", scene);
  seaMaterial.diffuseColor.set(0.39, 0.62, 0.68);
  seaMaterial.specularColor.set(0.18, 0.25, 0.28);
  seaMaterial.alpha = 0.96;
  sea.material = seaMaterial;

  state.renderer = renderer;
  state.sceneReady = true;
  statusLine.textContent =
    "Engine ready. Drag to orbit, scroll to zoom, and press F to toggle fullscreen.";

  let lastFrame = performance.now();
  let simulatedSpin = 0;

  const step = (deltaMs: number) => {
    simulatedSpin += deltaMs * 0.00028;
    islandCap.rotation.y = Math.PI / 6 + simulatedSpin;
    islandBase.rotation.y = Math.PI / 6 + simulatedSpin * 0.5;
    state.meshCount = scene.meshes.length;
    state.fps = engine.getFps();
    state.cameraRadius = camera.radius;
    updateHud();
  };

  engine.runRenderLoop(() => {
    const now = performance.now();
    step(now - lastFrame);
    lastFrame = now;
    scene.render();
  });

  window.advanceTime = (ms: number) => {
    step(ms);
    scene.render();
  };
  window.render_game_to_text = renderGameToText;

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
