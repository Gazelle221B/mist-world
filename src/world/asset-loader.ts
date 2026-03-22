// ---------------------------------------------------------------------------
// AssetLoader — resolves MeshDescriptors into Babylon.js source meshes
//
// Centralises mesh creation so the renderer never constructs geometry
// directly. Primitive descriptors are built on the spot; glTF descriptors
// are loaded via SceneLoader and cached by asset key.
// ---------------------------------------------------------------------------

import {
  type Mesh,
  MeshBuilder,
  type Scene,
  SceneLoader,
  type StandardMaterial,
} from "@babylonjs/core";
import type { MeshDescriptor } from "./tile-registry.ts";

const gltfCache = new Map<string, Mesh>();

function buildPrimitive(
  md: Extract<MeshDescriptor, { kind: "primitive" }>,
  scene: Scene,
  material: StandardMaterial,
): Mesh {
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

async function loadGltf(
  md: Extract<MeshDescriptor, { kind: "gltf" }>,
  scene: Scene,
  material: StandardMaterial,
): Promise<Mesh> {
  const cached = gltfCache.get(md.assetKey);
  if (cached && !cached.isDisposed()) return cached.clone(`src-${md.key}`)!;

  const result = await SceneLoader.ImportMeshAsync(
    md.meshName,
    "",
    md.assetKey,
    scene,
  );

  const source = result.meshes[0] as Mesh;
  source.scaling.setAll(md.scale);
  source.rotation.y = md.rotationY;
  source.material = material;
  source.hasVertexAlpha = true;
  source.setEnabled(false);
  gltfCache.set(md.assetKey, source);

  return source.clone(`src-${md.key}`)!;
}

/**
 * Resolve a MeshDescriptor into a ready-to-use source Mesh.
 *
 * Primitive descriptors are created synchronously (wrapped in a resolved
 * promise for API uniformity). glTF descriptors trigger an async load
 * with caching by assetKey.
 */
export async function loadMeshDescriptor(
  scene: Scene,
  material: StandardMaterial,
  descriptor: MeshDescriptor,
): Promise<Mesh> {
  switch (descriptor.kind) {
    case "primitive":
      return buildPrimitive(descriptor, scene, material);
    case "gltf":
      return loadGltf(descriptor, scene, material);
  }
}

/** Dispose all cached glTF source meshes. Call on teardown if needed. */
export function clearAssetCache(): void {
  for (const mesh of gltfCache.values()) {
    if (!mesh.isDisposed()) mesh.dispose();
  }
  gltfCache.clear();
}
