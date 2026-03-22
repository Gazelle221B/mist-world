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
import { terrainColor } from "./terrain.ts";

export interface IslandHandle {
  mesh: Mesh;
  material: StandardMaterial;
}

export function renderIsland(scene: Scene, tiles: TileData[]): IslandHandle {
  const material = new StandardMaterial("hex-terrain", scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.1, 0.1, 0.1);
  const source = MeshBuilder.CreateCylinder(
    "hex-source",
    { tessellation: 6, diameter: 1.73, height: 0.3 },
    scene,
  );
  source.material = material;
  source.rotation.y = Math.PI / 6;
  source.hasVertexAlpha = true;

  const matrices: Matrix[] = [];
  const colorData = new Float32Array(tiles.length * 4);

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const { x, z } = axialToWorld(tile.q, tile.r);
    matrices.push(Matrix.Translation(x, 0, z));

    const color = terrainColor(tile.terrain);
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
