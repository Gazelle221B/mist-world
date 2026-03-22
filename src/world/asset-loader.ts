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
import type { GltfMeshDescriptor, MeshDescriptor } from "./tile-registry.ts";

const gltfCache = new Map<string, Mesh>();
const gltfFallbackWarned = new Set<string>();

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

function buildFallbackPrimitive(
  md: GltfMeshDescriptor,
  scene: Scene,
  material: StandardMaterial,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    `src-${md.key}-fallback`,
    { tessellation: 6, diameter: 1.73, height: 1 },
    scene,
  );
  mesh.material = material;
  mesh.rotation.y = Math.PI / 6;
  mesh.hasVertexAlpha = true;
  return mesh;
}

/**
 * Resolve a MeshDescriptor into a ready-to-use source Mesh.
 *
 * Primitive descriptors are created synchronously (wrapped in a resolved
 * promise for API uniformity). glTF descriptors trigger an async load
 * with caching by assetKey. If a glTF load fails (e.g. asset not yet
 * deployed), a placeholder hex-cylinder is returned instead.
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
      try {
        return await loadGltf(descriptor, scene, material);
      } catch {
        if (!gltfFallbackWarned.has(descriptor.assetKey)) {
          console.warn(
            `AssetLoader: failed to load "${descriptor.assetKey}", using primitive fallback`,
          );
          gltfFallbackWarned.add(descriptor.assetKey);
        }
        return buildFallbackPrimitive(descriptor, scene, material);
      }
  }
}

/** Dispose all cached glTF source meshes. Call on teardown if needed. */
export function clearAssetCache(): void {
  for (const mesh of gltfCache.values()) {
    if (!mesh.isDisposed()) mesh.dispose();
  }
  gltfCache.clear();
}
