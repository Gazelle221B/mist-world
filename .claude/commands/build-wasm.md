---
description: Build the Rust/WASM crates (mist-wfc and mist-crypto)
---

# Build Rust/WASM

This command builds the necessary WASM crates and outputs them to the `src/wasm/` directory for Vite to consume.

## Commands to execute
Run these commands sequentially:

```bash
# Build mist-wfc
cd rust/mist-wfc && wasm-pack build --target web --out-dir ../../src/wasm/mist-wfc

# Build mist-crypto
cd rust/mist-crypto && wasm-pack build --target web --out-dir ../../src/wasm/mist-crypto
```

Check the outputs for any errors, especially related to `#![no_std]` or floating-point operations in `mist-wfc`.
