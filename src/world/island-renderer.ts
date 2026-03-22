import {
  Color3,
  Matrix,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
} from "@babylonjs/core";
import type { TileData } from "./wfc-bridge.ts";
import { axialToWorld } from "./hex-grid.ts";
import {
  lookupTile,
  type MeshDescriptor,
  type TileDescriptor,
} from "./tile-registry.ts";

export interface IslandHandle {
  dispose(): void;
}

interface TileEntry {
  tile: TileData;
  desc: TileDescriptor;
}

function createSourceMesh(
  md: MeshDescriptor,
  scene: Scene,
  material: StandardMaterial,
): Mesh {
  switch (md.kind) {
    case "primitive": {
      const mesh = MeshBuilder.CreateCylinder(
        `src-${md.key}`,
        { tessellation: md.tessellation, diameter: md.diameter, height: md.height },
        scene,
      );
      mesh.material = material;
      mesh.rotation.y = md.rotationY;
      mesh.hasVertexAlpha = true;
      return mesh;
    }
    case "gltf":
      throw new Error("glTF mesh descriptors are not wired yet");
  }
}

export function renderIsland(scene: Scene, tiles: TileData[]): IslandHandle {
  const material = new StandardMaterial("hex-terrain", scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.1, 0.1, 0.1);

  // Group tiles by mesh descriptor key
  const groups = new Map<string, { md: MeshDescriptor; entries: TileEntry[] }>();

  for (const tile of tiles) {
    const desc = lookupTile(tile.terrain);
    const meshKey = desc.mesh.key;
    let group = groups.get(meshKey);
    if (!group) {
      group = { md: desc.mesh, entries: [] };
      groups.set(meshKey, group);
    }
    group.entries.push({ tile, desc });
  }

  // Build source meshes and thin instances per group
  const meshes: Mesh[] = [];

  for (const [, group] of groups) {
    const source = createSourceMesh(group.md, scene, material);
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
