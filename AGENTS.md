# Mist World - Project Context & Guidelines

## Project Overview
Mist World is a browser-only, serverless 3D shared space. 
Players join via an invitation link, share an 8-byte seed to deterministically generate a hexagonal island locally, and can explore, chat, and build together.
The project heavily relies on a P2P architecture and zero cloud-server reliance for operational features (aside from signaling).

**Status:** Pre-Production (Sprint 0)
**Role:** Solo Developer

## Technology Stack
- **Frontend / Rendering:** Babylon.js 8.x (WebGPU primary, WebGL2 automatic fallback, Thin Instances for hex rendering, Havok WASM Physics, AudioEngineV2)
- **Networking:** mistlib (Rust/WASM WebRTC P2P by tik-choco-lab) / mistnet-signaling (Go)
- **State Synchronization:** Loro 1.x CRDT (for deterministic discrete state sync)
- **World Generation:** `mist-wfc` - Custom Rust/WASM integer based WFC (Wave Function Collapse)
- **Cryptography / Trust:** Ed25519 (Web Crypto API natively, WASM fallback) for Peer identity and Trust Score penalties.
- **Build / Tooling:** Vite 6.x, TypeScript 5.x, `wasm-pack`

## Build & Development Commands
- **Rust/WASM Build:**
  - `cd rust/mist-wfc && wasm-pack build --target web --out-dir ../../src/wasm/mist-wfc`
  - `cd rust/mist-crypto && wasm-pack build --target web --out-dir ../../src/wasm/mist-crypto`
- **Frontend Dev Server:**
  - `npm run dev` (Runs Vite server, usually with `concurrently` monitoring `cargo watch`)

## Architecture Rules & Decisions
### 1. Two-Layer Data Model (Critical)
- **Discrete Layer (CRDT Synced):** Data that must perfectly match across all peers. Includes Tile Maps (WFC output), Building placements, World Metadata, Chat Logs, Ownership tables, and Trust Scores. 
- **Continuous Layer (Local GPU Compute):** Data simulated locally, no network sync. Includes Boids, FFT Ocean/waves, Particles, Post-processes.

### 2. Deterministic Integer WFC (Critical)
- Floating point operations are **strictly prohibited** inside the `mist-wfc` Rust codebase. 
- You MUST use `ChaCha8Rng` for random number generation and `BTreeMap` for ensuring deterministic evaluation order across platforms.

### 3. Trust Score System
- Actions are locally validated. Invalid signatures (-0.5), WFC violations (-0.2), physics cheats (-0.1), and spam (-0.05) result in trust penalties.
- High trust implies super-peer relay capabilities in dense networks (Stage 3 Topology).

## Sprint Roadmap Reference
Currently entering **Sprint 0: Technical Verification**.
Please refer to `docs/TDD.md`, `docs/GDD.md` and `docs/proposal.md` for deep-dives into the CRDT structures, mistlib bridging, network topology (Stage 1-3), export file format (`.mistworld`), and exact sprint milestones.
