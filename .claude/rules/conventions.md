---
description: >
  Coding conventions, Git workflow, testing procedures, and critical project constraints (What to NEVER do).
  Apply whenever writing code or executing workflows.
paths: ["**/*"]
---

## Coding Conventions
- インデント: 2スペース (TypeScript), 4スペース (Rust)
- 関数は純粋関数を優先
- TypeScript: `any` は禁止。`unknown` + type guard を使う
- `console.log` を本番コードに残さない
- ファイル名は kebab-case (TypeScript), snake_case (Rust)

## Testing
- Rust: `cargo test` で全ユニットテストを実行
- WASM ビルド確認: `wasm-pack build --target web`
- Frontend: `npm run dev` で動作確認、`npm run typecheck` で型チェック
- E2Eテストは重要なフローのみ（Playwright）

## Git Workflow
- ブランチ命名: feat/xxx, fix/xxx, refactor/xxx
- コミットメッセージ: conventional commits
- 各worktreeタスク完了後に必ずコミット

## What to NEVER do
- ハードコードされたAPIキー・シークレットは絶対禁止
- 大きな変更の前に必ず確認を求めること
- 同一ブランチで2つのworktreeを同時にチェックアウトしない
- node_modules を直接編集しない
- `mist-wfc` Rust コード内で浮動小数点演算を使わない（整数演算のみ）
- `HashMap` を `mist-wfc` 内で使わない（`BTreeMap` を使う）