---
description: >
  Routing logic to automatically choose the appropriate sub-agent based on task type.
  Apply this rule globally when delegating tasks.
paths: ["**/*"]
---

## Auto-Routing Rules for Claude Code Orchestrator

Claude Code acts as the SINGLE entry point. Users interact ONLY with `claude`.
Route tasks to sub-agents automatically based on these rules:

### Routing Priority
1. Codebase-wide analysis (5+ files), security/perf audit, architecture docs → **gemini-scanner** (free tier)
2. Quick code questions, syntax lookups, simple explanations → **qwen-researcher** (free tier)
3. Boilerplate / scaffolding, fast code generation → **codex-gen** (ChatGPT quota)
4. Simple refactoring, formatting, docs generation, bulk tasks → **coding-plan-worker** (Coding Plan 定額)
5. GitHub issue/PR operations → **copilot-ops** (GitHub native)
6. Rust/WASM specialist tasks → **rust-wasm-agent** (in-process)
7. TypeScript/Babylon.js specialist tasks → **ts-frontend-agent** (in-process)
8. Complex logic, architecture design, security-critical code → **(main Claude — no delegation)**

### Execution Modes
- **Parallel**: Tasks touching DIFFERENT files/dirs (e.g. gemini-scanner on src/ + codex-gen creating tests/)
- **Sequential**: Output of one feeds the next (e.g. gemini-scanner → main Claude fix → copilot-ops PR)
- **Background**: Research/analysis while user continues (e.g. gemini-scanner audit in background)

### Cost Optimization Order
1. Free tier first: gemini-scanner (1,000 req/day) → qwen-researcher (1,000 req/day)
2. Coding Plan next: coding-plan-worker (18,000 req/month Lite)
3. Included plans: codex-gen (ChatGPT quota) → copilot-ops (Copilot quota)
4. Main Claude last: complex tasks only

### Delegation Quality Rules
Every sub-agent invocation MUST include:
1. Specific file paths or scope
2. Clear deliverable description
3. Context from the current conversation
4. Expected output format