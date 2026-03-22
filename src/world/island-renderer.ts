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
// ---------------------------------------------------------------------------

import {
  Color3,
  Color4,
  Matrix,
  type Mesh,
  MeshBuilder,
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

export interface IslandHandle {
  dispose(): void;
}

interface TileEntry {
  tile: TileData;
  desc: PrototypeDescriptor;
  worldQ: number;
  worldR: number;
}

/**
 * Render a single region's tiles as thin instances.
 *
 * @param macroQ   Macro-grid Q coordinate (0 for center region)
 * @param macroR   Macro-grid R coordinate (0 for center region)
 * @param spacing  Macro-grid spacing (2×radius + 1), 0 for legacy single-island
 */
export async function renderIsland(
  scene: Scene,
  tiles: TileData[],
  macroQ: number = 0,
  macroR: number = 0,
  spacing: number = 0,
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

  // Load source meshes and build thin instances per group
  const meshes: Mesh[] = [];

  for (const [, group] of groups) {
    const source = await loadMeshDescriptor(scene, material, group.md);
    source.setEnabled(true);
    const colorData = new Float32Array(group.entries.length * 4);

    for (let i = 0; i < group.entries.length; i++) {
      const { tile, desc, worldQ, worldR } = group.entries[i];
      const { x, z } = axialToWorld(worldQ, worldR);
      const rotY = tile.rotation * (Math.PI / 3);
      source.thinInstanceAdd(
        Matrix.Scaling(1, desc.height, 1)
          .multiply(Matrix.RotationY(rotY))
          .multiply(Matrix.Translation(x, desc.yOffset, z)),
      );
      colorData[i * 4 + 0] = desc.color.r;
      colorData[i * 4 + 1] = desc.color.g;
      colorData[i * 4 + 2] = desc.color.b;
      colorData[i * 4 + 3] = desc.color.a;
    }

    source.thinInstanceSetBuffer("color", colorData, 4);
    meshes.push(source);
  }

  return {
    dispose() {
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
