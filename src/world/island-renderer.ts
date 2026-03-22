// ---------------------------------------------------------------------------
// Island Renderer — builds thin-instanced hex tiles for a region
//
// Each region is rendered as a group of thin-instanced meshes, grouped by
// mesh descriptor key. The renderer is prototype-driven: tile color, height,
// and mesh type come from lookupPrototype(). Rotation is applied via
// Matrix.RotationY(rotation × π/3).
//
// Supports macro-grid offset: tiles are placed at world coordinates
// (macroQ × spacing + tileQ, macroR × spacing + tileR).
//
// Collapse animation: when `animate=true`, tiles rise from flat (y-scale 0)
// in collapse order over ANIM_DURATION_MS.
// ---------------------------------------------------------------------------

import {
  Color3,
  Color4,
  Matrix,
  type Mesh,
  MeshBuilder,
  type Observer,
  type Scene,
  StandardMaterial,
} from "@babylonjs/core";
import type { TileData } from "./wfc-bridge.ts";
import { axialToWorld } from "./hex-grid.ts";
import { loadMeshDescriptor } from "./asset-loader.ts";
import {
  lookupPrototype,
  type MeshDescriptor,
  type PrototypeDescriptor,
} from "./tile-registry.ts";

/** Total duration of the collapse stagger animation (ms). */
const ANIM_DURATION_MS = 600;

/** Per-tile rise duration (ms). */
const TILE_RISE_MS = 150;

export interface IslandHandle {
  /** Whether the collapse animation is still running. */
  readonly animating: boolean;
  dispose(): void;
}

interface TileEntry {
  tile: TileData;
  desc: PrototypeDescriptor;
  worldQ: number;
  worldR: number;
}

/** Tracks a single thin instance that needs to animate. */
interface AnimEntry {
  mesh: Mesh;
  instanceIdx: number;
  targetMatrix: Matrix;
  /** Stagger delay in ms derived from collapseOrder. */
  delayMs: number;
  revealed: boolean;
  // Per-tile render data for partial matrix reconstruction
  height: number;
  yOffset: number;
  rotY: number;
  worldX: number;
  worldZ: number;
}

/**
 * Render a single region's tiles as thin instances.
 *
 * @param macroQ   Macro-grid Q coordinate (0 for center region)
 * @param macroR   Macro-grid R coordinate (0 for center region)
 * @param spacing  Macro-grid spacing (2×radius + 1), 0 for legacy single-island
 * @param animate  If true, tiles rise in collapseOrder stagger
 */
export async function renderIsland(
  scene: Scene,
  tiles: TileData[],
  macroQ: number = 0,
  macroR: number = 0,
  spacing: number = 0,
  animate: boolean = false,
): Promise<IslandHandle> {
  const material = new StandardMaterial("hex-terrain", scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.1, 0.1, 0.1);

  // Group tiles by mesh descriptor key
  const groups = new Map<string, { md: MeshDescriptor; entries: TileEntry[] }>();

  for (const tile of tiles) {
    const desc = lookupPrototype(tile.prototypeId, tile.terrain);
    const meshKey = desc.mesh.key;
    let group = groups.get(meshKey);
    if (!group) {
      group = { md: desc.mesh, entries: [] };
      groups.set(meshKey, group);
    }
    const worldQ = macroQ * spacing + tile.q;
    const worldR = macroR * spacing + tile.r;
    group.entries.push({ tile, desc, worldQ, worldR });
  }

  // Compute max collapse order for normalisation
  let maxOrder = 0;
  if (animate) {
    for (const tile of tiles) {
      if (tile.collapseOrder > maxOrder) maxOrder = tile.collapseOrder;
    }
  }

  // Load source meshes and build thin instances per group
  const meshes: Mesh[] = [];
  const animEntries: AnimEntry[] = [];

  for (const [, group] of groups) {
    const source = await loadMeshDescriptor(scene, material, group.md);
    source.setEnabled(true);
    const colorData = new Float32Array(group.entries.length * 4);

    for (let i = 0; i < group.entries.length; i++) {
      const { tile, desc, worldQ, worldR } = group.entries[i];
      const { x, z } = axialToWorld(worldQ, worldR);
      const rotY = tile.rotation * (Math.PI / 3);

      const targetMatrix = Matrix.Scaling(1, desc.height, 1)
        .multiply(Matrix.RotationY(rotY))
        .multiply(Matrix.Translation(x, desc.yOffset, z));

      if (animate) {
        // Start flat (y-scale = 0) at the same position
        const flatMatrix = Matrix.Scaling(1, 0, 1)
          .multiply(Matrix.RotationY(rotY))
          .multiply(Matrix.Translation(x, desc.yOffset, z));
        const instanceIdx = source.thinInstanceAdd(flatMatrix);

        const delayMs = maxOrder > 0
          ? (tile.collapseOrder / maxOrder) * ANIM_DURATION_MS
          : 0;

        animEntries.push({
          mesh: source,
          instanceIdx,
          targetMatrix,
          delayMs,
          revealed: false,
          height: desc.height,
          yOffset: desc.yOffset,
          rotY,
          worldX: x,
          worldZ: z,
        });
      } else {
        source.thinInstanceAdd(targetMatrix);
      }

      colorData[i * 4 + 0] = desc.color.r;
      colorData[i * 4 + 1] = desc.color.g;
      colorData[i * 4 + 2] = desc.color.b;
      colorData[i * 4 + 3] = desc.color.a;
    }

    source.thinInstanceSetBuffer("color", colorData, 4);
    meshes.push(source);
  }

  // Animation state
  let isAnimating = animate && animEntries.length > 0;
  let observer: Observer<Scene> | null = null;

  if (isAnimating) {
    const startTime = performance.now();
    let revealedCount = 0;
    const total = animEntries.length;

    observer = scene.onBeforeRenderObservable.add(() => {
      const elapsed = performance.now() - startTime;
      let anyUpdated = false;

      for (const entry of animEntries) {
        if (entry.revealed) continue;

        if (elapsed < entry.delayMs) continue;

        const tileElapsed = elapsed - entry.delayMs;
        const t = Math.min(tileElapsed / TILE_RISE_MS, 1);

        if (t >= 1) {
          // Fully revealed — set final matrix
          entry.mesh.thinInstanceSetMatrixAt(
            entry.instanceIdx, entry.targetMatrix, false,
          );
          entry.revealed = true;
          revealedCount++;
          anyUpdated = true;
        } else {
          // Smooth-step easing for gentle rise
          const ease = t * t * (3 - 2 * t);
          const partialMatrix = Matrix.Scaling(1, entry.height * ease, 1)
            .multiply(Matrix.RotationY(entry.rotY))
            .multiply(Matrix.Translation(entry.worldX, entry.yOffset, entry.worldZ));
          entry.mesh.thinInstanceSetMatrixAt(
            entry.instanceIdx, partialMatrix, false,
          );
          anyUpdated = true;
        }
      }

      // Force buffer update for meshes that changed
      if (anyUpdated) {
        for (const m of meshes) {
          if (m.thinInstanceCount > 0) {
            m.thinInstanceBufferUpdated("matrix");
          }
        }
      }

      if (revealedCount >= total) {
        isAnimating = false;
        if (observer) {
          scene.onBeforeRenderObservable.remove(observer);
          observer = null;
        }
      }
    });
  }

  return {
    get animating() {
      return isAnimating;
    },
    dispose() {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      isAnimating = false;
      for (const m of meshes) m.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Placeholder markers — clickable hex indicators for unexpanded regions
// ---------------------------------------------------------------------------

export interface PlaceholderHandle {
  dispose(): void;
}

/**
 * Render placeholder hex markers for unexpanded regions.
 * Each marker stores its macro coordinates in mesh.metadata.
 */
export function renderPlaceholders(
  scene: Scene,
  placeholders: ReadonlyArray<{ macroQ: number; macroR: number }>,
  spacing: number,
): PlaceholderHandle {
  const material = new StandardMaterial("placeholder-mat", scene);
  material.diffuseColor = new Color3(0.9, 0.9, 0.85);
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  material.alpha = 0.35;

  const meshes: Mesh[] = [];

  for (const ph of placeholders) {
    const centerQ = ph.macroQ * spacing;
    const centerR = ph.macroR * spacing;
    const { x, z } = axialToWorld(centerQ, centerR);

    const marker = MeshBuilder.CreateCylinder(
      `placeholder-${ph.macroQ},${ph.macroR}`,
      { tessellation: 6, diameter: 2.2, height: 0.15 },
      scene,
    );
    marker.position.set(x, -0.5, z);
    marker.rotation.y = Math.PI / 6;
    marker.material = material;
    marker.isPickable = true;
    marker.metadata = { macroQ: ph.macroQ, macroR: ph.macroR };

    // Add a "+" indicator via vertex colors
    marker.enableEdgesRendering();
    marker.edgesWidth = 2;
    marker.edgesColor = new Color4(0.6, 0.6, 0.55, 0.6);

    meshes.push(marker);
  }

  return {
    dispose() {
      for (const m of meshes) m.dispose();
      material.dispose();
    },
  };
}
