---
description: Run the Sprint 0 technical verification checklist
---

# Sprint 0 Technical Verification

This command helps you go through the Sprint 0 checklist items defined in `docs/GDD.md` step by step.

## Instructions
1. First, check if the Vite and Rust codebases exist. If not, inform the user that the project must be initialized first.
2. Verify the WebGPU scene initialization.
3. Verify the WebGL2 fallback.
4. Verify mistlib WASM initialization and `joinRoom`.
5. Verify Loro CRDT WASM loading and basic operations.
6. Verify WFC integer constraint research/implementation.
7. Verify Ed25519 Web Crypto API.

Use `npm run test` and related testing commands once they are set up to verify these steps automatically where possible.
