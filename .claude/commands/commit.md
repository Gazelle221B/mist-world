---
description: Commit changes with a reminder about frequent commits
---

# Frequent Commit Workflow

Mist World is a complex project bridging Rust/WASM and TypeScript/Babylon.js. Frequent, isolated commits are critical for the `Solo Developer` workflow, allowing easy rollbacks using the `/rewind` command if something breaks.

## Developer Policy
- **Minimum commit frequency:** 1 commit per hour of work, or immediately after a feature works.
- NEVER mix Rust crate changes and Babylon.js rendering changes in the same commit unless strictly required for a single atomic feature.

## Instructions
1. Run `git status` to see what changed.
2. Run `git diff` to review the exact changes.
3. Propose a descriptive commit message following conventional commits (e.g., `feat(wfc): completely remove f32 usage`).
4. Wait for user approval.
5. If approved, `git add` the relevant files and `git commit -m "..."`.
