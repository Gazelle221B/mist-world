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

export interface IslandHandle {
  mesh: Mesh;
  material: StandardMaterial;
}

const TERRAIN_COLORS: readonly Color4[] = [
  new Color4(0.56, 0.74, 0.34, 1), // 0: grass
  new Color4(0.87, 0.82, 0.60, 1), // 1: sand
  new Color4(0.58, 0.55, 0.52, 1), // 2: rock
  new Color4(0.39, 0.62, 0.78, 1), // 3: water
];

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

    const color = TERRAIN_COLORS[tile.terrain] ?? TERRAIN_COLORS[0];
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
