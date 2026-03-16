---

# Mist World — Game Design Document v7.0

**最終更新**: 2026-03-12  
**ステータス**: Pre‑Production（Sprint 0 準備完了）  
**作成者**: Solo Developer  
**ドキュメント管理**: Git 管理、本文書が唯一の正本

---

## 0. 読者別サマリ

**ビジネスサイド向け**: Mist World はブラウザだけで動作するサーバレス 3D 共有空間である。8 バイトの「種（シード）」を共有するだけで全員が同一の六角形の島を生成でき、クラウドサーバを必要としない。月額インフラコストは $6〜26 に収まり、ユーザ数増加による従量課金爆発が構造的に起きない。差別化要素は決定論的な整数 WFC 地形生成、P2P トラストスコアシステム、`.mistworld` ポータブルファイルの 3 点。

**エンジニア向け**: Rust/WASM による整数 WFC（ChaCha8Rng + BTreeMap）、Babylon.js 8.x（WebGPU primary / WebGL2 fallback）、mistlib（tik-choco-lab 製 Rust/WASM WebRTC）による P2P、Loro 1.x CRDT による状態同期、Havok WASM 物理、Ed25519 署名によるトラストモデルで構成される。全スタックがブラウザ内で完結する。

---

## 1. コンセプト

Mist World は「種を渡すだけで同じ島が生まれる」ブラウザ完結型 P2P 共有空間である。

プレイヤーは招待リンクを開くだけで WebRTC メッシュに参加し、六角形タイル上に建物を建て、チャットし、空間を探索する。中央サーバを持たないため、サービス停止リスクがなく、`.mistworld` ファイルとしてエクスポートすれば世界を永続的にポータブルに保てる。

**コアループ**: シード共有 → 島生成 → 探索 → 建築 → 共有 → エクスポート

---

## 2. データモデル — 二層設計

Mist World のデータは「離散層（Discrete）」と「連続層（Continuous）」に厳密に分離される。これにより、ネットワーク帯域を構造的に最小化する。

**離散層（CRDT 同期対象）** は全ピア間で一致すべき状態を扱う。タイルマップ（WFC 出力のヘクスグリッド座標・タイル種別）、建築物（位置・回転・モデル ID・所有者）、ワールドメタデータ（シード・名前・作成日時・WASM ハッシュ）、チャットログ（タイムスタンプ・発言者 ID・テキスト）、オーナーシップテーブル（エンティティ ID → ピア ID の所有権）、トラストスコア（ピア ID → 数値・ラベル）がこれに含まれる。

**連続層（ローカル GPU 処理）** は各クライアントが独立して計算し、同期しない。Boids（鳥・魚群のフロッキング）、海面波形（FFT ComputeShader）、パーティクル（煙・霧・火花）、ポストプロセス（被写界深度・ブルーム・トーンマッピング）がこれに該当する。

**CRDT スコープ判定表**:

同期する（✓）: 建築物配置・削除、ワールドメタデータ、チャットメッセージ、オーナーシップ遷移、トラストスコア変更。

同期しない（✗）: アバター補間ポーズ（mistlib updatePosition で直接送信）、一時的物理衝突（ローカル Havok）、空間オーディオ状態、UI 状態。

---

## 3. テクノロジスタック

### 3.1 レンダリング — Babylon.js 8.x

**選定根拠**: Babylon.js 8.x（`@babylonjs/core` 8.52.0、npm 公開 2026-03-11）を採用する。ゼロ検証として Orillusion との比較評価を実施した結果、以下の理由で Babylon.js を選定した。

WebGPU をプライマリレンダラとしつつ、WebGL2 への自動フォールバックが v5.0（2022 年 5 月）以降バックワード互換で提供されている。WGSL ネイティブシェーダ対応（v8.0〜）により Node Material Editor から直接 WGSL を出力でき、カスタムヘクスタイルシェーダの開発が効率的である。Thin Instance は公式ベンチマークで 400 万キューブ @60 fps を実証しており、4,100 ヘクス程度のタイル描画は十分余裕がある。Havok WASM 物理が標準統合されており、v8.0 で PhysicsCharacterController が追加された。AudioEngineV2（v8.0〜）で空間オーディオが刷新され、メッシュへのサウンドアタッチが新 API で簡潔になった。GPU Picking（v8.0〜）により大量タイルのマウスヒット判定が GPU 側で完結する。Gaussian Splatting の SPZ / compressed PLY 対応（v8.0〜）により、将来的な 3D スキャンデータ統合の道が開かれている。

**WebGL2 フォールバック戦略**: WebGPU 非対応ブラウザでは自動的に WebGL2 エンジンが起動する。ComputeShader は無効化され、FFT 海面は CPU フォールバックまたは簡易アニメーションに切り替わる。Thin Instance、Havok 物理、基本シェーダは WebGL2 でも動作する。

### 3.2 P2P ネットワーク — mistlib

**選定根拠**: mistlib（tik-choco-lab 製、Rust/WASM、2024-06〜開発）を P2P コアライブラリとして採用する。matchbox は代替候補として評価したが、mistlib は同開発者の mistnet（Unity C# P2P ライブラリ）で実証済みの設計パターンを持ち、公開シグナリングサーバ `wss://rtc.tik-choco.com/signaling` が利用可能であり、fogverse 論文（DOI: 10.1109/ICCE-Taiwan58799.2023.10226934）で学術的裏付けがある点を重視した。

mistlib は以下の API を提供する。`init` / `joinRoom` / `leaveRoom` でルーム管理、`updatePosition` でアバター位置送信（60 Hz unreliable）、`sendMessage` で 3 種の配送モード（Reliable / UnreliableOrdered / Unreliable）、`getNeighbors` / AOI イベント（ENTERED / LEFT）で近傍管理、`storage_add` / `storage_get` で軽量 KV ストレージ、`onMediaEvent` でメディアトラック管理、`getStats` で接続統計を行う。

**トポロジ設計**: 1〜8 ピアではフルメッシュ 60 Hz 送信。9〜20 ピアでは 30 Hz に間引き＋ AOI フィルタリング。20 ピア超ではスーパーピアリレー構成に遷移する。フォールバック順は STUN → TURN → WebSocket。TURN 帯域上限は 200 kbps/peer。RTT > 500 ms または損失率 > 20 % が継続した場合、ビューオンリーモードに自動遷移する。

**シグナリングサーバ**: mistnet-signaling（Go 実装、https://github.com/tik-choco-lab/mistnet-signaling）を利用する。公開エンドポイント `wss://rtc.tik-choco.com/signaling` を開発・テスト用に使用し、プロダクション環境では Fly.io 上にセルフホストする（月額 $1〜5）。設定は `config.json` で行う。

### 3.3 CRDT — Loro 1.x

**選定根拠**: Loro 1.x（npm `loro-crdt` 1.10.6、gzip 約 285 KB）を状態同期に採用する。Yjs および Automerge との比較評価を行い、以下の結果から Loro を選定した。Loro は Eg-walker アルゴリズム（OT と CRDT のハイブリッド）により、1.66M 操作のドキュメントインポートが 1 ms（shallow snapshot 0.37 ms）で完了する。Yjs は同条件で 2,616 ms、Automerge はさらに遅い。バンドルサイズは gzip 後 約 285 KB で許容範囲内。shallow snapshot によるブロック単位遅延ロード（約 4 KB/block）が可能であり、大規模ワールドのインクリメンタルロードに適している。Git ライクなバージョン管理（DAG、ブランチ、マージ、リベース）が組み込まれている。

**使用する CRDT コンテナ**: 建築物一覧は `LoroList<LoroMap>`、ワールドメタデータは `LoroMap`、チャットログは `LoroList<LoroMap>`、オーナーシップは `LoroMap`、トラストスコアは `LoroMap`。

### 3.4 署名・トラスト — Ed25519

Ed25519 は Web Crypto API 経由でネイティブ利用する。Chrome 137（2025 年 5 月〜）、Firefox 129（2024 年 8 月〜）、Safari 17 で対応しており、2026 年 3 月現在のブラウザカバレッジは約 79 %。非対応ブラウザ向けには `@yoursunny/webcrypto-ed25519` ポニーフィル（内部で `@noble/ed25519` を使用）、または `ed25519-dalek` の WASM ビルドをフォールバックとする。

各ピアは初回接続時にキーペアを生成し、公開鍵のハッシュをピア ID の導出元とし、WebRTC 接続直後のハンドシェイク RPC で公開鍵を交換する。全 CRDT 操作には Ed25519 署名が付与され、受信側で検証される。署名不正の操作はトラストスコアのペナルティ対象となる。秘密鍵は IndexedDB に `non-extractable` で保存し、XSS 等による生鍵の直接流出リスクを軽減する（署名操作の悪用リスクは残る）。

**トラストスコア UX**: スコアは 0.0〜1.0 の浮動小数点で管理し、4 段階のラベルと色で表示する。Trusted（0.8〜1.0、緑）、Normal（0.5〜0.79、黄）、Caution（0.2〜0.49、橙）、Blocked（0.0〜0.19、赤）。ブロック・解除はアバター右クリックメニューから行う。スコアは `trust.toml` としてローカル保存される。

**スコア変動ルール**: 署名不正 −0.5、WFC 整合性違反 −0.2、物理不正 −0.1、スパム送信（1 秒間に 10 メッセージ超） −0.05、正常接続中は +0.01/分（上限 1.0）。

### 3.5 ワールド生成 — 整数 WFC

Rust で `mist-wfc` クレートを自作し、WASM にコンパイルする。乱数は `ChaCha8Rng`（シードから決定論的に初期化）、データ構造は `BTreeMap`（挿入順序が決定論的）を使用し、浮動小数点演算を完全に排除する。これにより、同一シード（u64）から全プラットフォームでバイト単位で同一のタイルマップが生成されることを保証する。

**実装選択肢**: `gridbugs/wfc` クレート（v0.10.7）をフォークして浮動小数点を整数に置換する方式（見積り 1〜2 週間）と、フルスクラッチで整数 WFC を実装する方式（見積り 2〜3 週間）を Sprint 0 で評価し、Sprint 1 開始時に決定する。

**ヘクスグリッド座標**: honeycomb-grid（npm `honeycomb-grid` v4.1.5）の座標系（axial coordinates）を論理レイヤで採用する。TypeScript 対応、Red Blob Games 準拠。Babylon.js 側の 3D 配置は axial → world 座標変換関数で接続する。

### 3.6 物理 — Havok WASM

Babylon.js 統合の Havok 物理エンジン（`@babylonjs/havok`）を使用する。v8.0 で追加された PhysicsCharacterController により、階段・スロープ・ジャンプの処理が標準化された。ベンチマーク目標は 3,000 エンティティ @60 fps。Havok は WASM モジュールとしてロードされるため、WebGPU / WebGL2 どちらのレンダラでも動作する。

### 3.7 オーディオ — AudioEngineV2

Babylon.js 8.0 の AudioEngineV2 を使用する。空間オーディオは最大同時 5 スロット、距離ヒステリシスによる自動フェードイン・フェードアウト、メッシュアタッチによる 3D ポジショニングを実装する。ボイスチャットは mistlib の `onMediaEvent` でメディアトラックを取得し、AudioEngineV2 の空間ノードに接続する。マイクは 1 クリック ON/OFF。

### 3.8 アセット — KayKit Medieval Hexagon Pack

KayKit Medieval Hexagon Pack（CC0 ライセンス、200+ モデル、リカラー含め約 450 バリエーション）を基本アセットとして採用する。.FBX / .GLTF / .OBJ 形式が提供されており、Babylon.js では .GLTF を使用する。GitHub リポジトリ: https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 。Itch.io: https://kaylousberg.itch.io/kaykit-medieval-hexagon 。

### 3.9 ビルド・開発環境

Vite 6 をバンドラとして使用する。Rust/WASM のビルドは `wasm-pack` 経由で Vite プラグインに統合する。OPFS（Origin Private File System）をローカルストレージに使用し、CRDT スナップショットと `.mistworld` ファイルの永続化を行う。

---

## 4. .mistworld ファイルフォーマット

`.mistworld` はワールドのポータブルなエクスポート形式である。JSON エンベロープに以下のフィールドを持つ。

`version`（string）: フォーマットバージョン（"1.0.0"）。`seed`（string）: ワールド生成シード（u64 の文字列表現）。`wasmHash`（string）: WFC WASM モジュールの SHA-256 ハッシュ（再現性検証用）。`engine`（string）: 使用エンジン識別子（"mist-wfc@1.0.0"）。`snapshot`（string）: Loro スナップショットの Base64 エンコード。`metadata`（object）: ワールド名・作成日時・作成者公開鍵。`trustPolicy`（object）: 詳細なペナルティ係数と最低スコア。`signature`（string）: エンベロープ全体の Ed25519 署名（Base64）。

インポート時には `wasmHash` を検証し、一致しない場合は警告を表示してユーザに続行可否を確認する。復元時は `CrdtStore.importSnapshot(snapshot)` を用いて CRDT の状態が一括ロードされる。

---

## 5. 招待リンク

形式: `https://mist.world/join?room={roomId}&token={signedToken}`

`roomId` は UUID v4。`token` は招待者の Ed25519 秘密鍵で署名されたペイロード（roomId + exp + tokenId）。`exp` は UNIX タイムスタンプで、デフォルト有効期限は 24 時間。参加者は WebRTC 接続確立直後にトークンを送信し、既存ピアが署名、期限、および CRDT 上の失効済み `tokenId` リストを検証してアクセスを判定する。招待の取り消しは対象の `tokenId` を CRDT メタデータの失効リストに追加することで全ピアに伝播する。

---

## 6. 帯域幅見積り

**低ピア構成（4 ピア、フルメッシュ 60 Hz）**: アバター位置（48 byte × 60 Hz × 3 peer = 8.64 KB/s）＋ CRDT 差分（平均 0.2 KB/s）＋ チャット（0.1 KB/s）＋ 制御（0.5 KB/s）≈ 約 9.4 KB/s（≈ 75 kbps）上り。下り同等。合計約 150 kbps。

**高ピア構成（16 ピア、30 Hz + AOI）**: アバター位置（48 byte × 30 Hz × 8 visible = 11.52 KB/s）＋ CRDT 差分（0.5 KB/s）＋ チャット（0.3 KB/s）＋ 制御（1.0 KB/s）≈ 約 13.3 KB/s（≈ 106 kbps）上り。下り同等。合計約 212 kbps。

---

## 7. mistnet → TypeScript 設計パターン移植

mistnet（Unity C#）の設計パターンを TypeScript / Babylon.js に移植する。

**RPC**: mistnet の `[MistRpc]` 属性は TypeScript デコレータ `@MistRpc()` に変換する。`mistNode.rpcAll(methodName, ...args)` / `mistNode.rpcOther(methodName, ...args)` / `mistNode.rpc(peerId, methodName, ...args)` の 3 パターンを提供する。シリアライズは MessagePack（mistnet の MemoryPack に相当）。

**変数同期**: mistnet の `[MistSync]` 属性は Proxy ベースの自動同期に変換する。`onChange` コールバックは Loro CRDT の Map subscribe で実装する。

**同期エンティティ**: mistnet の `MistSyncObject` は `MistSyncEntity` クラス（Babylon.js TransformNode を継承）に変換する。

**トランスフォーム同期**: mistnet の `MistTransform` は mistlib の `updatePosition` API にマッピングし、受信側で線形補間を適用する。

**プレファブスポーン**: mistnet の Addressables ベースの `InstantiateAsync` は、glTF AssetContainer + `mistNode.rpcAll('spawn', assetId, position, rotation)` に変換する。

---

## 8. tik-choco エコシステムからの活用リソース

**mistlib（tik-choco-lab、2024-06〜）**: P2P コアライブラリとして直接使用。API: init, joinRoom, leaveRoom, updatePosition, sendMessage, getNeighbors, storage_add/get, onMediaEvent, getStats。

**mistnet-signaling（tik-choco-lab、Go）**: シグナリングサーバとして使用。公開エンドポイント `wss://rtc.tik-choco.com/signaling`。プロダクションではセルフホスト。

**mistnet（tik-choco-lab、2024-02〜）**: Unity C# 実装を TypeScript API 設計のリファレンスとして使用。MistSyncObject / MistTransform / MistRpc / MistSync のパターンを移植。

**fogverse（tik-choco-lab、2023-01〜）**: 二層アーキテクチャ（Content Layer + Realtime Layer）の設計根拠。IPFS + WebRTC の構成を参考にしつつ、Content Layer を Loro CRDT + OPFS に簡略化。

**miniverse（tik-choco-lab、2022-05〜）**: YAML ワールド記述フォーマット（id → file/type/position/rotation/scale/parent/child/custom）を `.mistworld` スキーマ設計の参考とする。

**location-sync（tik-choco-lab、2022-10〜）**: P2P 位置同期の学術的根拠。論文 DOI: 10.57460/vconf.2022.0_101。

**tc-message（tik-choco）**: C# Pub/Sub ライブラリ。TypeScript イベントバス設計のリファレンス。

---

## 9. Sprint 0 — 技術検証チェックリスト（2 週間）

**Babylon.js レンダリング検証**: Vite 6 + `@babylonjs/core` 8.52+ で WebGPU シーンが起動すること。WebGPU 非対応ブラウザで WebGL2 に自動フォールバックすること。KayKit ヘクスタイル 1 枚を Thin Instance で 4,100 個複製し、60 fps を維持すること。Node Material Editor で WGSL シェーダを出力し、ヘクスタイルに適用できること。

**mistlib P2P 検証**: WASM init + joinRoom が公開シグナリングサーバ経由で 5 秒以内に完了すること。Unreliable 送信の RTT が LAN 2 ピア環境で 100 ms 以内であること。Reliable 送信で 100 メッセージが全数到達すること。updatePosition を 60 Hz で送信してもフレームドロップが発生しないこと。AOI イベント（ENTERED / LEFT）が正しく受信されること。メディアトラック追加が確認できること。WASM バンドルの gzip サイズが 500 KB 以内であること。

**Loro CRDT 検証**: LoroDoc を 2 ピア間で生成し、Map/List の同時編集が自動マージされること。スナップショットの OPFS 保存・復元が正常に動作すること。shallow snapshot の読み込みが 5 ms 以内であること。

**整数 WFC 検証**: ChaCha8Rng + BTreeMap で浮動小数点を一切使用しない WFC プロトタイプ（3×3 最小グリッド）が、同一シードから Chrome / Firefox / Safari で同一出力を生成すること。`gridbugs/wfc` v0.10.7 のソースを精査し、浮動小数点除去の工数を見積もること。

**Ed25519 検証**: Web Crypto API で Ed25519 キーペア生成・署名・検証が Chrome / Firefox / Safari で動作すること。非対応ブラウザで `@yoursunny/webcrypto-ed25519` ポニーフィルが正常にフォールバックすること。

**Go/No-Go 判定**: 上記全項目が Pass であれば Sprint 1 に進む。いずれかが Fail の場合、代替案（matchbox への切り替え、CPU WFC フォールバック等）を検討し、1 週間の延長バッファで再検証する。

---

## 10. ロードマップ（20 週間 Vertical Slice）

**Sprint 0（Week 1〜2）**: 上記技術検証チェックリストの全項目を実施。Go/No-Go 判定。

**Sprint 1（Week 3〜6）**: 整数 WFC の本実装（`mist-wfc` クレート）。honeycomb-grid による axial 座標 → Babylon.js world 座標変換。KayKit アセットのタイル種別マッピング。Thin Instance によるヘクスグリッド一括描画。WGSL ComputeShader による海面 FFT（WebGPU のみ）。

**Sprint 2（Week 7〜10）**: mistlib によるアバター P2P 同期（updatePosition 60 Hz + 線形補間）。MistSyncEntity クラス実装。RPC デコレータとメッセージルーティング。Ed25519 署名付き接続ハンドシェイク。トラストスコア初期実装。

**Sprint 3（Week 11〜14）**: Loro CRDT による建築物同期。建物の配置・削除の CRDT 操作。チャットログの CRDT 同期。オーナーシップテーブル。Havok 物理による建物衝突判定。OPFS への CRDT スナップショット自動保存。

**Sprint 4（Week 15〜18）**: `.mistworld` ファイルのエクスポート・インポート実装。招待リンク生成・検証。AudioEngineV2 による空間オーディオ。ボイスチャット（mistlib onMediaEvent 連携）。WebGL2 フォールバックの全機能テスト。

**Sprint 5（Week 19〜20）**: パフォーマンスチューニング（Tier A: 4,100 hexes @60 fps 確認）。ビューオンリーモードのテスト。UI ポリッシュ（トラストスコア表示、ブロック UI、招待 UI）。Vertical Slice デモ完成。

---

## 11. 技術スタック一覧

**npm パッケージ**: `@babylonjs/core` 8.52+, `@babylonjs/havok`, `@babylonjs/loaders`, `@babylonjs/materials`, `loro-crdt` 1.10+, `honeycomb-grid` 4.1.5, `vite` 6.x, `@msgpack/msgpack`（RPC シリアライズ）, `@yoursunny/webcrypto-ed25519`（フォールバック）。

**Rust クレート**: `rand_chacha`（ChaCha8Rng）, `serde` + `serde_json`, `wasm-bindgen`, `wasm-pack`, `ed25519-dalek`（WASM フォールバック用）。`mist-wfc`（自作、整数 WFC）。

**WGSL ユーティリティ**: `wgsl-noise`（https://github.com/ZRNOF/wgsl-noise — webgl-noise の WGSL ポート）, `wgsl-fns`（https://github.com/koole/wgsl-fns — WGSL ユーティリティ関数集）。

**外部サービス**: mistnet-signaling（Go、セルフホスト on Fly.io）, TURN サーバ（任意、Fly.io or Cloudflare）, ドメイン（mist.world）。

---

## 12. コスト見積り

シグナリングサーバ（Fly.io shared-cpu-1x）: $1〜5/月。TURN サーバ（任意、Fly.io or Cloudflare Workers）: $0〜10/月。静的ホスティング（Cloudflare Pages）: $0。ドメイン（mist.world）: $5〜11/年（≈ $0.5〜1/月）。合計: $1.5〜16/月。最大構成（専用 TURN + ドメイン + CDN）でも $26/月以内。

---

## 13. 成功指標

Sprint 0 Go/No-Go 全項目 Pass。mistlib 2 ピア間 RTT ≤ 100 ms。整数 WFC のクロスブラウザバイト一致率 100 %。Vertical Slice デモ完成（Sprint 5 終了時）。Tier A（WebGPU）: 4,100 hexes + 8 アバター @60 fps。Tier B（WebGL2）: 4,100 hexes + 4 アバター @30 fps。30 ピア構成で p90 RTT ≤ 200 ms。ビューオンリーフォールバックが正常動作。`.mistworld` エクスポート → 別ブラウザでインポート → 同一ワールド再現。

---

## 14. リスク・軽減策

**mistlib の成熟度**: mistlib は開発初期段階である可能性がある。軽減策として Sprint 0 で全 API を検証し、Fail 時は matchbox（Rust/WASM WebRTC、https://github.com/johanhelsing/matchbox）に切り替える。matchbox は v0.6 で reliable/unreliable チャネル対応済み。

**整数 WFC の実装工数**: `gridbugs/wfc` のフォーク改修が想定以上に複雑な場合がある。軽減策としてフルスクラッチ実装（2〜3 週間）を並行見積りし、Sprint 0 の結果で判断する。

**Loro のバンドルサイズ**: WASM バンドルが最大 2.9 MB（非圧縮）に達する可能性がある。軽減策として gzip（≈ 285 KB）を前提とし、lazy loading でブロック単位読み込みを行う。

**WebGPU ブラウザ互換性**: WebGPU は 2026 年 3 月時点で約 70 % のブラウザカバレッジ。軽減策として WebGL2 自動フォールバックを Sprint 0 で検証済みとする。

**Havok WASM パフォーマンス**: モバイルブラウザで物理演算がボトルネックになる可能性がある。軽減策として物理エンティティ数の動的制限（LOD 的に遠方の物理を無効化）を実装する。

**Ed25519 ブラウザカバレッジ**: 約 79 % のカバレッジのため、21 % のユーザがフォールバックを必要とする。軽減策として `@yoursunny/webcrypto-ed25519` ポニーフィルを自動検出で切り替える。

---

## 15. 決定ログ

| #    | 決定事項                         | 根拠                                                                                                    | 日付       |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| D-01 | シード型は u64                   | 十分なエントロピー（1.8×10¹⁹ 通り）かつ WASM で効率的                                                   | 2026-03-12 |
| D-02 | 招待リンク有効期限デフォルト 24h | セキュリティと利便性のバランス                                                                          | 2026-03-12 |
| D-03 | レンダラ: Babylon.js 8.x         | ゼロ検証の結果、WebGPU+WebGL2 フォールバック、Thin Instance、Havok 統合、AudioEngineV2 等の総合力で選定 | 2026-03-12 |
| D-04 | P2P: mistlib                     | tik-choco エコシステムの実績、公開シグナリングサーバ、学術的裏付け                                      | 2026-03-12 |
| D-05 | CRDT: Loro 1.x                   | ベンチマーク最速、shallow snapshot、バージョン管理内蔵                                                  | 2026-03-12 |
| D-06 | WFC 実装方式                     | Sprint 0 終了時に判定（gridbugs fork vs フルスクラッチ）                                                | 未決定     |
| D-07 | トラストペナルティ係数           | 署名不正 −0.5 / WFC 違反 −0.2 / 物理不正 −0.1 / スパム −0.05 / 正常 +0.01/min                                           | 2026-03-12 |

---

## 16. 参考 URL

Babylon.js リポジトリ: https://github.com/BabylonJS/Babylon.js  
Babylon.js 8.0 リリース: https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9  
Babylon.js ComputeShader ドキュメント: https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader  
Babylon.js WebGPU / WebGL2 サポート: https://doc.babylonjs.com/setup/support/webGPU  
Babylon.js Thin Instance: https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances  
Babylon.js Havok プラグイン: https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin  
Babylon.js PhysicsCharacterController: https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController/  
Babylon.js AudioEngineV2: https://doc.babylonjs.com/typedoc/classes/BABYLON.AudioEngineV2  
Babylon.js GPU Picking: https://aka.ms/babylon8gpuPickDemo  
Babylon.js Node Material Editor: https://doc.babylonjs.com/toolsAndResources/nge  
Babylon.js Node Geometry: https://doc.babylonjs.com/features/featuresDeepDive/mesh/nodeGeometry  
mistlib リポジトリ: https://github.com/tik-choco-lab/mistlib  
mistnet リポジトリ: https://github.com/tik-choco-lab/mistnet  
mistnet-signaling リポジトリ: https://github.com/tik-choco-lab/mistnet-signaling  
fogverse リポジトリ: https://github.com/tik-choco-lab/fogverse  
miniverse リポジトリ: https://github.com/tik-choco-lab/miniverse  
location-sync リポジトリ: https://github.com/tik-choco-lab/location-sync  
tc-message リポジトリ: https://github.com/tik-choco/tc-message  
tik-choco-lab org: https://github.com/tik-choco-lab  
tik-choco org: https://github.com/tik-choco  
fog-zs（開発者）: https://github.com/fog-zs  
シグナリングサーバ公開エンドポイント: wss://rtc.tik-choco.com/signaling  
fogverse 論文: https://doi.org/10.1109/ICCE-Taiwan58799.2023.10226934  
location-sync 論文: https://doi.org/10.57460/vconf.2022.0_101  
Loro 1.0 ブログ: https://loro.dev/blog/v1.0  
Loro ドキュメント: https://loro.dev/docs/tutorial/get_started  
Loro パフォーマンス: https://loro.dev/docs/performance  
honeycomb-grid npm: https://www.npmjs.com/package/honeycomb-grid  
honeycomb-grid ドキュメント: https://abbekeultjes.nl/honeycomb/  
gridbugs/wfc クレート: https://crates.io/crates/wfc  
KayKit Medieval Hexagon Pack (GitHub): https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0  
KayKit Medieval Hexagon Pack (Itch.io): https://kaylousberg.itch.io/kaykit-medieval-hexagon  
wgsl-noise: https://github.com/ZRNOF/wgsl-noise  
wgsl-fns: https://github.com/koole/wgsl-fns  
Ed25519 Web Crypto (Chrome Status): https://chromestatus.com/feature/4913922408710144  
Ed25519 ポニーフィル: https://github.com/yoursunny/webcrypto-ed25519  
Popov72 OceanDemo: https://github.com/Popov72/OceanDemo  
matchbox（フォールバック候補）: https://github.com/johanhelsing/matchbox

---

## 17. 次のアクション

1. Vite 6 プロジェクトを `npm create vite@latest mist-world -- --template vanilla-ts` で初期化
2. `@babylonjs/core`, `@babylonjs/havok`, `@babylonjs/loaders`, `loro-crdt`, `honeycomb-grid` をインストール
3. WebGPU シーンの起動を確認（Canvas + Engine + Scene + HemisphericLight + CreateGround）
4. WebGL2 フォールバックを DevTools で GPU エミュレーション無効化して確認
5. mistnet-signaling をローカルで起動（`go run .`）
6. Sprint 0 チェックリストを順次実行

---

_— End of Document —_
