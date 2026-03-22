Original prompt: Fix the Sprint 0 scaffold so the Mist World repository has a real Vite/Babylon.js + Rust/WASM foundation that matches the frozen design docs and is actually buildable.

- Replacing the copied Vite starter with a minimal Babylon bootstrap.
- Rebuilding package metadata so dependencies are declared reproducibly.
- Keeping Rust crates as WASM-ready stubs because `cargo` is unavailable in this environment for full verification.
- Added Sprint 0 Rust-facing placeholder APIs: deterministic WFC preview output and SHA-256 peer ID derivation helpers.
- Next step is a clean npm reinstall to replace the broken copied `node_modules` and regenerate `package-lock.json`.
- `npm install`, `npm run typecheck`, and `npm run build` now pass from the repo root.
- Verified the Babylon bootstrap in a real browser with the web-game Playwright client; clean run artifacts are in `output/web-game-pass/`.
- Remaining known gap: Rust / `wasm-pack` verification is still blocked here because the environment does not have `cargo`.

## glTF Asset Pipeline

### Descriptor API (confirmed)

`GltfMeshDescriptor` in `tile-registry.ts`:

```typescript
{
  kind: "gltf",
  key: string,        // cache/naming key (e.g. "rock-gltf")
  assetKey: string,    // file path from public/ (e.g. "/assets/terrain/rock.glb")
  meshName: string,    // mesh name inside glTF ("" = auto-select first non-root)
  scale: number,       // uniform scale applied to source mesh
  rotationY: number,   // Y-axis rotation in radians
}
```

### Asset placement rules

- Place terrain glTF files at `public/assets/terrain/{key}.glb`
- Files in `public/` are served as-is by Vite; `assetKey` paths are relative to site root
- Use `.glb` (binary glTF) for smaller payloads

### meshName selection

- If `meshName` is set and matches a mesh in the file → that mesh is used
- If `meshName` is set but no match → warn with available names, use first non-`__root__` mesh
- If `meshName` is `""` → auto-select first non-`__root__` mesh

### Fallback behaviour

- If the glTF file is missing or fails to load → `console.warn` (once per assetKey), substitute a placeholder hex-cylinder
- The fallback primitive matches the default hex-cylinder geometry so the island renders correctly
- Drop in the real `.glb` file and reload — no code changes needed
