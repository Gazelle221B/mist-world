#!/usr/bin/env bash
cat <<'EOF'
[AUTO-ROUTING REMINDER]
Available sub-agents and when to use them:
- @gemini-scanner: codebase-wide analysis (5+ files), security/performance audits, architecture docs → uses FREE Gemini CLI
- @codex-gen: boilerplate, scaffolding, simple CRUD → uses Codex CLI
- @copilot-ops: GitHub issues, PRs, branch management → uses gh/copilot CLI
- @coding-plan-worker: bulk tasks, simple refactoring, docs generation → uses Coding Plan (cost-effective)
- @qwen-researcher: quick code questions, lookups → uses FREE QwenCode CLI
- @rust-wasm-agent: Rust/WASM specialist tasks (in-process, no external CLI)
- @ts-frontend-agent: TypeScript/Babylon.js specialist tasks (in-process, no external CLI)
- Direct (no delegation): complex architecture, security-critical logic, multi-step iterative design

RULE: If the task matches a sub-agent description above, delegate to that sub-agent FIRST. Only handle directly if no sub-agent matches or the task requires Opus-level reasoning.
EOF
