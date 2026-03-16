Original prompt: Fix the Sprint 0 scaffold so the Mist World repository has a real Vite/Babylon.js + Rust/WASM foundation that matches the frozen design docs and is actually buildable.

- Replacing the copied Vite starter with a minimal Babylon bootstrap.
- Rebuilding package metadata so dependencies are declared reproducibly.
- Keeping Rust crates as WASM-ready stubs because `cargo` is unavailable in this environment for full verification.
- Added Sprint 0 Rust-facing placeholder APIs: deterministic WFC preview output and SHA-256 peer ID derivation helpers.
- Next step is a clean npm reinstall to replace the broken copied `node_modules` and regenerate `package-lock.json`.
- `npm install`, `npm run typecheck`, and `npm run build` now pass from the repo root.
- Verified the Babylon bootstrap in a real browser with the web-game Playwright client; clean run artifacts are in `output/web-game-pass/`.
- Remaining known gap: Rust / `wasm-pack` verification is still blocked here because the environment does not have `cargo`.
