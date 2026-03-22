import {
  Color3,
  Matrix,
  type Mesh,
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
}

export async function renderIsland(
  scene: Scene,
  tiles: TileData[],
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
    group.entries.push({ tile, desc });
  }

  // Load source meshes and build thin instances per group
  const meshes: Mesh[] = [];

  for (const [, group] of groups) {
    const source = await loadMeshDescriptor(scene, material, group.md);
    source.setEnabled(true);
    const colorData = new Float32Array(group.entries.length * 4);

    for (let i = 0; i < group.entries.length; i++) {
      const { tile, desc } = group.entries[i];
      const { x, z } = axialToWorld(tile.q, tile.r);
      source.thinInstanceAdd(
        Matrix.Scaling(1, desc.height, 1).multiply(
          Matrix.Translation(x, desc.yOffset, z),
        ),
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
