---

# Mist World — 企画書 v7.0

**日付**: 2026-03-12
**ステータス**: Babylon.js + mistlib ベース・全技術ゼロ検証済み
**著者**: Solo Developer（バーティカルスライスまで 1 人）

---

## 0. 読者別サマリー

**経営・非技術者向け**

Mist World はブラウザだけで動くサーバーレス 3D 仮想空間である。8 バイトのシード値を共有するだけで全参加者が同一のヘックス島を手元で生成し、建築・会話・探索を楽しめる。サーバー維持費は月額 6-26 ドルで済み、ユーザー増加に伴うクラウドコスト爆発が起きない。差別化軸は「整数 WFC による決定論的地形生成」「P2P 信頼スコアシステム」「.mistworld ファイルによる完全ポータビリティ」の 3 点である。

**エンジニア向け**

Rust/WASM 整数 WFC ソルバー（ChaCha8Rng + BTreeMap）で決定論的ヘックスマップを生成する。描画は Babylon.js 8.x（WebGPU 優先、WebGL2 自動フォールバック）で、Thin Instance による 4000 超ヘックスの高速レンダリングと Havok 物理（WASM, MIT）を組み合わせる。P2P 通信には mistlib（tik-choco-lab 製 Rust/WASM WebRTC）を採用し、シグナリングには同チームの mistnet-signaling（Go）をそのまま利用する。状態同期は Loro CRDT 1.x（gzip 285 KB）で行い、署名検証には Ed25519（Web Crypto API + ed25519-dalek WASM フォールバック）を使う。データモデルは決定論的離散層（CRDT 同期）とローカル連続層（WGSL ComputeShader）の二層構成とする。

**コントリビューター向け**

Sprint 0 は Babylon.js + mistlib の最小 2 ピア同期デモから始まる。コードは Rust ワークスペース（mist-wfc, mist-sync, mist-validator）と TypeScript（Vite 6 + @babylonjs/\*）の構成とし、MIT / Apache-2.0 互換ライセンスで公開する。

---

## 1. コンセプト

ブラウザ間で共有されるサーバーレス 3D ヘックスアイランドワールドである。プレイヤーは u64 シード値を共有するだけで全ピアが同一の島を決定論的に生成する。建築・メタデータ・チャットは CRDT で同期し、.mistworld ファイルでワールドをエクスポート・インポートすることで完全なポータビリティを確保する。

思想的基盤は tik-choco-lab の fogverse プロジェクト（2023）が提唱した二層アーキテクチャ、すなわち Content Layer（IPFS による分散コンテンツ保存）と Realtime Layer（WebRTC による P2P リアルタイム同期）の分離にある。Mist World はこれを Web ネイティブに再構成し、Content Layer を Loro CRDT + OPFS に、Realtime Layer を mistlib + WGSL ComputeShader に置き換える。

---

## 2. 二層データモデル

### 2.1 離散層（Deterministic / CRDT-synced）

WFC タイルマップ（整数座標、BTreeMap）、建築データ、ワールドメタデータ、チャット履歴、物理所有権テーブル、信頼スコアを含む。これらは Loro CRDT で同期し、全ピアが同一状態に収束する。

### 2.2 連続層（Local simulation / GPU compute）

Boids 群体シミュレーション、Gerstner 波、パーティクル、ポストプロセスエフェクトを含む。WGSL ComputeShader でローカル実行し、ネットワーク同期は行わない。

### 2.3 CRDT スコープテーブル

| 対象                     | CRDT 同期 | データ型  | 備考                      |
| ------------------------ | --------- | --------- | ------------------------- |
| 建築（タイル配置・削除） | ○         | Loro Map  | Sprint 3 で実装           |
| ワールドメタデータ       | ○         | Loro Map  | ワールド名・作成者等      |
| チャット                 | ○         | Loro List | テキストメッセージ        |
| 物理所有権テーブル       | ○         | Loro Map  | Phase D で実装            |
| 信頼スコア               | ○         | Loro Map  | Phase C で実装            |
| アバター位置・回転       | ×         | —         | mistlib Unreliable + 補間 |
| 一時物理（飛散・投擲物） | ×         | —         | ローカル装飾のみ          |
| 音声ストリーム           | ×         | —         | mistlib MediaStream       |
| UI ステート              | ×         | —         | ローカルのみ              |

---

## 3. アーキテクチャ

### 3.1 レンダリング — Babylon.js 8.x

Babylon.js 8.0（2025-03-27 リリース、npm 最新 8.54.1、Apache-2.0）を選定した。

**選定根拠（ゼロ検証結果）**

| 検証項目                           | 結果                                                                            | 判定 |
| ---------------------------------- | ------------------------------------------------------------------------------- | ---- |
| WebGPU + WebGL2 自動フォールバック | エンジン初期化時に自動判定、コード変更不要                                      | ◎    |
| WGSL コアシェーダー                | 8.0 で全コアシェーダーがネイティブ WGSL 化済み、旧 twgsl 変換層（3 MB）が不要に | ◎    |
| ComputeShader                      | 公式サンプル豊富（Boids, FFT-Ocean, Hydraulic Erosion, Image Blur）             | ◎    |
| NME → WGSL                         | Node Material Editor が 8.0 で WGSL 出力に対応                                  | ◎    |
| Thin Instance                      | 4M+ cubes @60fps の実績、ヘックスグリッド高速描画に最適                         | ◎    |
| DefaultRenderingPipeline           | Bloom, DoF, SSAO2, ChromaticAberration, Grain が組込済み                        | ◎    |
| Havok Physics                      | WASM, MIT, 3000 エンティティ @60fps 実績、Character Controller 付属             | ◎    |
| AudioEngineV2                      | Web Audio API ベースの空間音声、メッシュアタッチ対応                            | ◎    |
| GPU Mesh Picking                   | 8.0 新機能、ヘックスタイル選択に活用                                            | ◎    |
| Node Geometry                      | プロシージャルメッシュ生成（Blender Geometry Nodes 風）                         | ◎    |
| Gaussian Splat (SPZ)               | 将来的に 3D スキャンデータの島配置に活用                                        | ◎    |
| Hex Tile チュートリアル            | Babylon.js 公式 6 パートシリーズ（2020）が存在                                  | ◎    |
| コミュニティ                       | 23k+ stars, 500+ contributors, 活発なフォーラム                                 | ◎    |

**フォールバック戦略**

WebGPU 非対応ブラウザでは WebGL2 Engine に透過的にフォールバックする。ComputeShader（WebGPU 専用）は WebGL2 モードで無効化し、Boids・FFT-Ocean 等のエフェクトは CPU 簡易版またはスキップとする。コアレンダリング・物理・CRDT 同期はすべて WebGL2 でも動作する。

### 3.2 P2P 通信 — mistlib（確定）

tik-choco-lab 製 Rust/WASM P2P ライブラリ **mistlib** を採用する。

**選定根拠**

mistlib は 2022 年の location-sync 研究（doi:10.57460/vconf.2022.0_101）から始まり、fogverse（ICCE-Taiwan 2023, doi:10.1109/ICCE-Taiwan58799.2023.10226934）を経て、2024 年に独立ライブラリとして公開された。メタバース用途に特化しており、AOI（Area of Interest）、位置同期、メディアストリーム対応が組込済みである。Unity 版の mistnet で MistSyncObject / RPC / 変数同期パターンが実証済みであり、設計の信頼性が高い。

**API マッピング**

| mistlib API                     | Mist World での用途                                | データチャネル    |
| ------------------------------- | -------------------------------------------------- | ----------------- |
| `joinRoom(roomId)`              | ワールド参加                                       | —                 |
| `leaveRoom()`                   | ワールド退出                                       | —                 |
| `updatePosition(x, y, z)`       | アバター位置送信                                   | Unreliable        |
| `sendMessage(toId, payload, 2)` | 位置・回転ブロードキャスト (60 Hz)                 | Unreliable        |
| `sendMessage(toId, payload, 1)` | 物理状態送信                                       | UnreliableOrdered |
| `sendMessage('', payload, 0)`   | CRDT diff ブロードキャスト                         | Reliable          |
| `sendMessage(toId, payload, 0)` | RPC 呼び出し                                       | Reliable          |
| `getNeighbors()`                | AOI 内ピア取得                                     | —                 |
| `getAllNodes()`                 | 全ピアリスト                                       | —                 |
| `onEvent(handler)`              | RAW / OVERLAY / NEIGHBORS / AOI_ENTERED / AOI_LEFT | —                 |
| `onMediaEvent(handler)`         | TRACK_ADDED / TRACK_REMOVED（音声）                | —                 |
| `getStats()`                    | RTT / loss / uptime 取得（スコア計算用）           | —                 |
| `storage_add(path, data)`       | ローカルデータ永続化補助                           | —                 |
| `storage_get(path)`             | ローカルデータ読み出し                             | —                 |

**mistnet 設計パターンの TypeScript 移植**

mistnet（Unity C#）の設計パターンを TypeScript に移植して API 設計のベースとする。

| mistnet (C#)                                    | Mist World (TypeScript)                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `[MistRpc]` + `RPCAll` / `RPCOther` / `RPC(id)` | `@MistRpc()` デコレータ + `rpcAll()` / `rpcOther()` / `rpc(peerId)`         |
| `[MistSync]` プロパティ同期 + `OnChanged`       | Proxy ベース自動同期 + `onChange` コールバック（Loro Map subscribe と統合） |
| `MistSyncObject` コンポーネント                 | `MistSyncEntity` クラス（Babylon.js TransformNode にアタッチ）              |
| `MistTransform` 位置同期                        | `updatePosition` + 線形補間                                                 |
| Addressable Prefab Instantiation                | glTF AssetContainer + `rpcAll('spawn', assetId, pos)`                       |

### 3.2.1 シグナリングサーバー — mistnet-signaling（Go）

tik-choco-lab 製 Go 言語シグナリングサーバーをそのまま利用する。WebSocket ベースで Room 管理と SDP/ICE Candidate リレーを行う。

**開発時**: 公開サーバー `wss://rtc.tik-choco.com/signaling` を直接利用（Sprint 0-5）。

**本番時**: mistnet-signaling を Fly.io にデプロイ。Go ビルド → Docker → `fly launch`。free tier（256 MB RAM）で十分。

**プロトコル**: `{ Type: "Request"|"offer"|"answer"|"candidate", Data, SenderId, ReceiverId, RoomId }` の JSON メッセージ。

### 3.2.2 P2P トポロジー

8 ピア以下はフルメッシュ 60 Hz とする。9-20 ピアでは 30 Hz + AOI フィルタ（mistlib getNeighbors）とする。21 ピア以上ではスーパーピアリレーに移行する。スコア式は `score = 0.4·(1/RTT) + 0.3·(1-loss) + 0.2·uptime + 0.1·battery` とする。

### 3.2.3 通信フォールバック

DataChannel 確立失敗時は STUN → TURN → WebSocket の順にフォールバックする。RTT > 500 ms or loss > 20% で「閲覧モード（view-only）」に自動切替する。閲覧モードでは建築・チャット送信を無効化し、受信のみ許可する。TURN 経由時の帯域上限は 200 kbps/ピアとする。

### 3.3 CRDT 同期 — Loro 1.x

loro-crdt 1.0（2025-09 GA、npm 最新 1.10.4）を使用する。

| 指標               | Loro 1.x                                                    | Yjs              | Automerge                |
| ------------------ | ----------------------------------------------------------- | ---------------- | ------------------------ |
| バンドル (gzip)    | 285 KB                                                      | 25 KB            | 894 KB                   |
| 実世界編集適用時間 | 768 ms                                                      | 2,616 ms         | 2,271 ms                 |
| parseTime          | 4 ms                                                        | 27 ms            | 6 ms                     |
| CRDT 型            | Fugue, Movable Tree/List, LWW Map, 版管理, Shallow Snapshot | Text, Array, Map | Text, List, Map, Counter |

Loro は実世界ベンチで Yjs・Automerge より高速であり、Shallow Snapshot で巨大ドキュメントにも対応する。建築データ（Map）+ チャット（List）の組み合わせに最適である。4 MB の非圧縮 WASM はレイジーロードで対処する。

### 3.4 署名・信頼 — Ed25519

Ed25519 は Web Crypto API で Chrome 137+（2025-08）、Firefox 129+、Safari 17+ にネイティブ対応しており、ブラウザカバレッジは約 79% である。非対応ブラウザでは ed25519-dalek WASM にフォールバックする。

**信頼スコア UX**

| スコア範囲 | ラベル  | 色  | 権限                 |
| ---------- | ------- | --- | -------------------- |
| 0.8 - 1.0  | Trusted | 緑  | 全操作               |
| 0.5 - 0.79 | Normal  | 黄  | 建築可、物理制限あり |
| 0.2 - 0.49 | Caution | 橙  | 閲覧 + チャットのみ  |
| 0.0 - 0.19 | Blocked | 赤  | 自動切断候補         |

ユーザーは相手のアバター上にスコアラベルを常時表示される。ブロック・アンブロックは右クリックメニューから操作する。ブロックは即時切断し、ローカル trust.toml に記録する。

**減点・加点ルール**

| イベント            | スコア変動           |
| ------------------- | -------------------- |
| 署名不正            | -0.5（即切断）       |
| WFC 制約違反        | -0.2                 |
| 物理不正            | -0.1                 |
| スパム（>10 msg/s） | -0.05                |
| 正常操作            | +0.01/分（上限 1.0） |

### 3.5 整数 WFC — mist-wfc（Rust/WASM）

gridbugs/wfc クレートを調査した結果、エントロピー計算に浮動小数点を使用している可能性がある。Sprint 0 でソースを精査し、整数化パッチ工数を見積もる。代替として自前実装（整数エントロピー = 残存候補数のみ、log 不要）を検討する。BTreeMap でソート順序を保証し、ChaCha8Rng で決定論的乱数を得る。

| 方針                            | 工数   | リスク                       |
| ------------------------------- | ------ | ---------------------------- |
| gridbugs/wfc パッチ             | 1-2 週 | 内部構造把握に時間           |
| 自前 WFC（整数のみ）            | 2-3 週 | 機能限定だがフル制御         |
| wave-function-collapse 0.3 利用 | 1 週   | API が抽象的、hex 対応要検証 |

### 3.6 物理 — Havok（Babylon.js 統合）

Babylon.js 8.0 の Havok Character Controller を利用する。@babylonjs/havok（WASM, MIT）は 3000 エンティティ @60fps の実績がある。

| カテゴリ        | 内容                 | 同期                   | MVP          |
| --------------- | -------------------- | ---------------------- | ------------ |
| A: アバター移動 | 地面コリジョン、重力 | mistlib Unreliable     | ○            |
| B: 飛散・投擲物 | 装飾のみ             | ローカルのみ（非同期） | ×（非必須）  |
| C: 建築物理     | 構造的整合性         | CRDT 制約検証          | △（Phase D） |

### 3.7 空間音声 — AudioEngineV2

Babylon.js 8.0 の AudioEngineV2 を使用する。

| パラメータ       | 値                                           |
| ---------------- | -------------------------------------------- |
| 同時スロット     | 5（距離ソート、最近傍）                      |
| ヒステリシス     | 出入り距離差 2 m（入場 < 15 m, 退場 > 17 m） |
| マイク許可フロー | 1 クリック（getUserMedia + 即時空間配置）    |
| フォールバック   | 非対応時はモノラル + 距離減衰のみ            |

### 3.8 レンダリングフォールバック詳細

WebGPU 利用可の場合は WebGPUEngine を使用し、ComputeShader（Boids, FFT-Ocean, 地形ノイズ）、NME WGSL 出力、DefaultRenderingPipeline の全機能が利用可能となる。WebGPU 非対応の場合は WebGL2 Engine にフォールバックし、ComputeShader は CPU 簡易版またはスキップ、NME は GLSL モード、DefaultRenderingPipeline は一部制限つきで動作する。

---

## 4. 技術スタック

### 4.1 npm パッケージ

| パッケージ             | バージョン           | 用途                                      | 検証状況      |
| ---------------------- | -------------------- | ----------------------------------------- | ------------- |
| @babylonjs/core        | 8.x（latest 8.54.1） | レンダリングエンジン                      | ◎ stable      |
| @babylonjs/loaders     | 8.x                  | glTF/glb ローダー                         | ◎             |
| @babylonjs/materials   | 8.x                  | 追加マテリアル                            | ◎             |
| @babylonjs/havok       | latest               | Havok Physics（WASM）                     | ◎ MIT         |
| @babylonjs/gui         | 8.x（latest 8.50.2） | 2D UI オーバーレイ                        | ◎             |
| @babylonjs/inspector   | 8.x                  | デバッグツール（devDependency）           | ◎             |
| loro-crdt              | 1.x（latest 1.10.4） | CRDT 同期                                 | ◎ gzip 285 KB |
| honeycomb-grid         | 4.1.5                | ヘックス座標計算                          | ◎ TypeScript  |
| vite                   | 6.x                  | ビルドツール                              | ◎             |
| typescript             | 5.x                  | 型付け                                    | ◎             |
| three（devDependency） | latest               | TSL → WGSL 変換（オフラインビルド時のみ） | △ オプション  |

### 4.2 Rust/WASM クレート

| クレート                 | 用途                                        | 検証状況          |
| ------------------------ | ------------------------------------------- | ----------------- |
| rand 0.8 + rand_chacha   | ChaCha8Rng 決定論乱数                       | ◎                 |
| serde + serde_json       | BTreeMap シリアライゼーション               | ◎                 |
| sha2 0.10                | SHA-256 ハッシュ                            | ◎                 |
| ed25519-dalek            | Ed25519 署名（Web Crypto 非対応ブラウザ用） | ◎ WASM 動作確認済 |
| wasm-bindgen + wasm-pack | WASM ビルド                                 | ◎                 |
| gridbugs/wfc（候補）     | WFC アルゴリズム                            | △ 整数化要検証    |
| mistlib-wasm             | P2P WebRTC（確定）                          | ○                 |
| loro（Rust）             | CRDT（サーバーサイド検証用）                | ◎                 |

### 4.3 WGSL シェーダーソース

3 チャネルで WGSL シェーダーを調達する。

**チャネル 1: Babylon.js 公式サンプル** — Boids, FFT-Ocean（Popov72/OceanDemo）、Hydraulic Erosion, Image Blur を bindingsMapping 調整のみで利用する。

**チャネル 2: hex-map-wfc TSL → WGSL 変換** — Three.js TSL Transpiler でオフライン変換し、Babylon.js ComputeShader に静的文字列として注入する。対象は海岸波アニメーション、カスタムポストプロセス（GTAO, Vignette, Film Grain）とする。

**チャネル 3: 汎用 WGSL ライブラリ** — wgsl-noise（webgl-noise の WGSL ポート）、wgsl-fns（数学ユーティリティ）、psrdnoise を Babylon.js ShaderStore.ShadersStoreWGSL に直接登録する。

### 4.4 アセット

KayKit Medieval Hexagon Pack（CC0）— 200 超のスタイライズド中世ヘックスタイル・建物・小道具。OBJ/FBX/glTF 形式で提供される。

### 4.5 Babylon.js 8.0 新機能の活用マップ

| 機能                       | 活用                                               |
| -------------------------- | -------------------------------------------------- |
| WGSL コアシェーダー        | twgsl 不要で WebGPU バンドル半減                   |
| NME → WGSL                 | ヘックスタイル地形シェーダーをノードエディタで作成 |
| Node Geometry              | 将来のプロシージャルヘックスメッシュ自動生成       |
| IBL Shadows                | 島全体の環境照明シャドウ                           |
| AudioEngineV2              | 空間音声（P2P ボイスチャット）                     |
| Havok Character Controller | アバター移動                                       |
| GPU Mesh Picking           | ヘックスタイル選択（建築 UI）                      |
| Thin Instance              | 4100 超ヘックスタイル高速描画                      |
| Gaussian Splat (SPZ)       | 将来のユーザー 3D スキャンデータ配置               |
| Lightweight Viewer         | 将来の .mistworld プレビューウィジェット           |

---

## 5. tik-choco-lab エコシステム連携

### 5.1 エコシステム全体像

tik-choco-lab は 2022 年から分散型メタバースの研究開発を行っている日本のラボ組織である。開発者 fog-zs を中心に、miniverse（2022-05）→ location-sync（2022-10）→ fogverse（2023-01）→ mistnet（2024-02）→ mistlib（2024-06）と段階的にプロダクトを発展させてきた。Mist World はこのエコシステムの上に構築する。

### 5.2 リポジトリ別活用方針

| リポジトリ            | 概要                                    | Mist World での利用                                                    | 利用時期      |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| **mistlib**           | Rust/WASM P2P（Web/Native/Unity対応）   | P2P 通信基盤（確定）                                                   | Sprint 0 から |
| **mistnet-signaling** | Go 製 WebSocket シグナリングサーバー    | シグナリングサーバー（開発は公開サーバー、本番は自前デプロイ）         | Sprint 0 から |
| **mistnet**           | Unity 用 P2P ライブラリ（C#）           | TypeScript API 設計の参照元（MistSyncObject / RPC / 変数同期パターン） | Sprint 2-3    |
| **fogverse**          | 分散メタバース（Unity + IPFS + WebRTC） | 二層アーキテクチャの思想的基盤 + 学術論文による裏付け                  | 設計済み      |
| **miniverse**         | 初期プロトタイプ（YAML ワールド記述）   | .mistworld ファイルスキーマ設計の参考                                  | Sprint 4      |
| **location-sync**     | P2P 位置同期研究（論文付き）            | 設計根拠の学術的裏付け                                                 | ドキュメント  |
| **wuyu-protocol**     | fogverse プロトコル仕様                 | 将来的なプロトコル互換性検討                                           | 未定          |
| **tc-message**        | Unity 用メッセージ駆動処理（MIT）       | イベントバス設計の参考                                                 | Sprint 2      |

### 5.3 学術論文

| 論文                         | DOI                                    | 活用                                           |
| ---------------------------- | -------------------------------------- | ---------------------------------------------- |
| location-sync（vconf 2022）  | 10.57460/vconf.2022.0_101              | P2P 位置同期の設計根拠                         |
| fogverse（ICCE-Taiwan 2023） | 10.1109/ICCE-Taiwan58799.2023.10226934 | 分散メタバース二層アーキテクチャの学術的裏付け |

---

## 6. .mistworld ファイル仕様

```jsonc
{
  "version": "1.0.0",
  "seed": "0x00A1B2C3D4E5F678",
  "wasmHash": "sha256:...",
  "engine": "mist-wfc@1.0.0",
  "snapshot": "Base64 encoded Loro snapshot bytes...",
  "metadata": {
    "name": "My Island",
    "createdAt": "2026-03-12T00:00:00Z",
    "creatorPubKey": "ed25519:...",
  },
  "trustPolicy": {
    "signatureForgery": -0.5,
    "wfcViolation": -0.2,
    "physicsCheat": -0.1,
    "spam": -0.05,
    "normalOp": 0.01,
    "minScore": 0.2,
  },
  "signature": "ed25519:...",
}
```

**設計参考**: miniverse の YAML ワールド記述（objects → id → file/type/position/rotation/scale/parent/child/custom）を JSON に再構成した。

**バージョン互換性ポリシー**: WASM バイナリに git commit ハッシュと semver を埋め込む。ハンドシェイク時に SHA-256 と semver を交換し、メジャーバージョン不一致は接続拒否、マイナーバージョン不一致は警告のみとする。各メジャーバージョンに MIGRATION.md を同梱する。

---

## 7. 招待リンク仕様

形式は `https://mist.world/join?room={roomId}&token={token}` とする。有効期限のデフォルトは 24 時間で、選択肢として 1 h / 6 h / 24 h / 7 d を提供する。token はペイロード（roomId + exp + tokenId）を作成者の Ed25519 秘密鍵で署名しエンコードしたものとする。参加者は WebRTC 接続直後にトークンを送信する。失効は作成者が対象の `tokenId` を CRDT メタデータの失効リストに追加し、既存ピアがハンドシェイク時に検証して接続を拒否する。

---

## 8. 帯域見積

| 密度                              | シード        | 位置同期 | 建築 diff | 音声     | 合計/ピア  |
| --------------------------------- | ------------- | -------- | --------- | -------- | ---------- |
| 低（≤8 ピア）                     | 150 B（初回） | 50 kbps  | 0.2 kbps  | 64 kbps  | ≈ 115 kbps |
| 高（30 ピア、スーパーピアリレー） | 150 B         | 43 kbps  | 1 kbps    | 160 kbps | ≈ 204 kbps |

---

## 9. バーティカルスライス ロードマップ（1 人, 20 週）

**定義**: 2 つのブラウザタブで同一シード島を描画し、2 アバターが歩行し、1 タイルを建築して同期し、.mistworld ファイルをエクスポート・インポートできること。

### Sprint 0 — 技術検証（2 週）

| タスク                                                         | 合格基準                               | 失敗時代替                     |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| Babylon.js WebGPU 初期化 + ComputeShader（簡易カラー変換）     | WebGPUEngine で ComputeShader 実行成功 | WebGL2 モードで進行            |
| Babylon.js Thin Instance で 1000 ヘックス描画                  | 60 fps（Tier A: M1/RTX 3060 相当）     | LOD・カリングで対処            |
| Babylon.js NME WGSL でノイズベース地形マテリアル作成           | NME エディタで作成しシーンに適用       | 手書き WGSL                    |
| mistlib WASM 初期化 + joinRoom（公開シグナリングサーバー経由） | ≤ 5 秒で接続確立                       | mistnet-signaling 自前デプロイ |
| mistlib sendMessage（Unreliable）RTT 測定                      | ≤ 100 ms（LAN 2 ピア）                 | —                              |
| mistlib sendMessage（Reliable）配信保証テスト                  | 100 メッセージ全着                     | —                              |
| mistlib onMediaEvent（TRACK_ADDED）音声受信確認                | 受信成功                               | Phase E に先送り               |
| Loro CRDT WASM ロード + Map 操作                               | 初期化 ≤ 2 秒、Map set/get 動作        | Yrs にフォールバック           |
| gridbugs/wfc ソース内 float 使用箇所特定                       | 工数見積 ≤ 2 週                        | 自前 WFC 実装に切替            |
| Ed25519 Web Crypto 動作確認（Chrome, Firefox, Safari）         | 3 ブラウザで keypair 生成・署名・検証  | ed25519-dalek WASM             |

### Sprint 1 — WFC + 静的描画（4 週）

Rust ワークスペース mist-wfc で整数 WFC ソルバーを実装する。10-15 タイル種、1000-1500 ヘックスとし、WASM にコンパイルして BTreeMap → JSON → JS に変換し、Babylon.js Thin Instance で KayKit アセットを配置・描画する。

**Exit**: Chrome と Edge で同一 JSON マップ出力かつ 60 fps 描画。

### Sprint 2 — P2P アバター同期（4 週）

mistlib で joinRoom によるルーム接続を実装する。キーボード操作と Havok Character Controller でアバターを移動させ、sendMessage（Unreliable）で位置・回転を 60 Hz 送信する。リモートアバターは線形補間で表示する。mistnet の MistTransform パターンを TypeScript に移植する。

**Exit**: localhost で 2 タブ間アバター移動がリアルタイム同期（RTT ≤ 100 ms）。

### Sprint 3 — CRDT 建築同期 + OPFS（4 週）

Loro Map で建築データを管理する。最小 UI（タイル配置・削除ボタン）を実装する。sendMessage（Reliable）で CRDT diff を送信する。OPFS に 60 秒ごと + visibilitychange でスナップショットを保存する。mistnet の `[MistSync]` パターンを TypeScript の Proxy ベース自動同期に移植する。

**Exit**: 片方のタブで建築が他方に表示され、リロード後も復元される。

### Sprint 4 — Export/Import + 統合テスト（4 週）

.mistworld ファイル生成（version, seed, wasmHash, snapshot）を実装する。エクスポートボタンとインポートによるマップ + 建築復元を実装する。クロスブラウザテスト（Chrome → Edge）を行う。

**Exit**: バーティカルスライス定義をすべて満たすデモ。

### Sprint 5 — バッファ（2 週）

残バグ修正、デモ動画作成、CONTRIBUTING.md、イシューテンプレート、アーキテクチャ図を整備する。

---

## 10. フルスコープ ロードマップ（チーム拡大後, 10-12 ヶ月）

バーティカルスライス完了後、以下を段階的に追加する。

**Phase A — WGSL コンピュート拡張（8 週）**: 地形ノイズ、Gerstner 波（Popov72/OceanDemo ベース）、DefaultRenderingPipeline（Bloom/SSAO2/DoF）、Boids、GTAO。デバイスティア検出（Tier A: 4100 超 hexes、Tier B: 2000 hexes）。

**Phase B — 群島トポロジー（6 週）**: 航路シード生成、島間移動、.mistworld の複数島対応。

**Phase C — 信頼・Sybil 対策（6 週）**: 信頼スコア UI（ラベル表示、ブロック・アンブロック）、外部 trust.toml、ゲスト権限制御。

**Phase D — Havok 物理 + 建築制約（6 週）**: Havok 統合深化、建築構造検証、カテゴリ B（装飾物理、非必須）。

**Phase E — 空間音声 + スーパーピアリレー（8 週）**: AudioEngineV2 空間音声、距離ソート 5 スロット、ヒステリシス、1 クリックマイク許可、スーパーピア選出・フェイルオーバー、閲覧モードフォールバック。

**Phase F — ポリッシュ（4 週）**: モバイル最適化、ドキュメント、OSS 公開、CI/CD。

**ストレッチゴール（MVP 外）**: Gaussian Splat 統合、WebXR VR/AR 対応（現在 WebGPU-WebXR 非対応のため待ち）、Node Render Graph カスタムパイプライン、Lightweight Viewer による .mistworld プレビュー、カスタムアバターシステム。

---

## 11. 実装前決定事項

| 決定事項                 | 結論                                                      | 根拠                           |
| ------------------------ | --------------------------------------------------------- | ------------------------------ |
| 島シード表現             | u64（8 B）、表示は 12 桁 16 進 + BIP-39 風語句            | 共有容易性と衝突回避           |
| 招待リンク有効期限       | デフォルト 24 h（1 h/6 h/24 h/7 d 選択可）                | UX バランス                    |
| 招待リンク失効メカニクス | 作成者が revocation list に追加し CRDT 伝播               | 分散環境での即時失効           |
| 信頼スコア違反重み       | 署名不正 -0.5, WFC 違反 -0.2, 物理不正 -0.1, スパム -0.05 | 重大度に応じた段階的ペナルティ |
| レンダラ                 | Babylon.js 8.x                                            | ゼロ検証結果                   |
| P2P ライブラリ           | mistlib（確定）                                           | tik-choco-lab エコシステム活用 |
| シグナリングサーバー     | mistnet-signaling（Go）                                   | そのまま利用可                 |
| WFC 実装                 | gridbugs/wfc パッチ or 自前（Sprint 0 で決定）            | 整数化可否による               |
| CRDT                     | Loro 1.x                                                  | 性能・機能・バンドルサイズ     |

---

## 12. リスクマトリクス

| リスク                              | 影響度 | 確率 | 対策                                    |
| ----------------------------------- | ------ | ---- | --------------------------------------- |
| mistlib WASM バンドルサイズ・安定性 | 高     | 中   | Sprint 0 で実測、超過時はレイジーロード |
| 整数 WFC 実装工数超過               | 中     | 中   | 自前実装（最小機能）にフォールバック    |
| Loro WASM 4 MB ロード時間           | 中     | 低   | レイジーロード + Shallow Snapshot       |
| Babylon.js WebGPU バグ              | 低     | 低   | WebGL2 自動フォールバック               |
| 公開シグナリングサーバーの可用性    | 中     | 中   | Sprint 0 で自前デプロイ手順を確立       |
| Ed25519 ブラウザカバレッジ不足      | 低     | 低   | ed25519-dalek WASM フォールバック       |

---

## 13. コスト見積

| 項目                                                | 月額         |
| --------------------------------------------------- | ------------ |
| シグナリングサーバー（Fly.io）                      | $0-5         |
| TURN サーバー（Metered.ca free tier → 有料）        | $0-10        |
| 静的ホスティング（GitHub Pages / Cloudflare Pages） | $0           |
| ドメイン（mist.world）                              | ≈ $1         |
| **合計**                                            | **$1-16/月** |

---

## 14. 成功指標

| フェーズ | 指標                          | 目標値   |
| -------- | ----------------------------- | -------- |
| Sprint 0 | 全 Go/No-Go 項目合格          | 10/10    |
| Sprint 1 | WFC バイト一致（同一シード）  | 100%     |
| Sprint 2 | 2 ピア RTT（mistlib）         | ≤ 100 ms |
| Sprint 4 | バーティカルスライス完了      | 定義通り |
| Phase A  | Tier A 4100 hexes @60 fps     | 達成     |
| Phase E  | 30 ピア p90 RTT               | ≤ 200 ms |
| リリース | .mistworld クロスデバイス移行 | 100%     |

---

## 15. 参考 URL

| リソース                              | URL                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Babylon.js（Apache-2.0）              | https://github.com/BabylonJS/Babylon.js                                                                           |
| Babylon.js 8.0 リリース               | https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9                                              |
| Babylon.js ComputeShader              | https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader                               |
| Babylon.js WebGPU/WebGL2 透過サポート | https://babylonjs.medium.com/transparently-supporting-both-webgl-and-webgpu-in-babylon-js-8379272a4306            |
| Babylon.js Hex Tile チュートリアル    | https://forum.babylonjs.com/t/new-demo-video-series-hex-tile-game-board-with-procedurally-generated-islands/13581 |
| Babylon.js AudioEngineV2              | https://doc.babylonjs.com/typedoc/classes/BABYLON.AudioEngineV2                                                   |
| Babylon.js Thin Instance              | https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances                                     |
| Babylon.js Node Geometry              | https://doc.babylonjs.com/features/featuresDeepDive/mesh/nodeGeometry                                             |
| Popov72/OceanDemo（FFT-Ocean WebGPU） | https://github.com/Popov72/OceanDemo                                                                              |
| Havok Physics Plugin                  | https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin                                           |
| mistlib（P2P WebRTC Rust/WASM）       | https://github.com/tik-choco-lab/mistlib                                                                          |
| mistnet（Unity P2P, C#）              | https://github.com/tik-choco-lab/mistnet                                                                          |
| mistnet-signaling（Go）               | https://github.com/tik-choco-lab/mistnet-signaling                                                                |
| fogverse（分散メタバース）            | https://github.com/tik-choco-lab/fogverse                                                                         |
| miniverse（初期プロト）               | https://github.com/tik-choco-lab/miniverse                                                                        |
| location-sync（論文付き）             | https://github.com/tik-choco-lab/location-sync                                                                    |
| wuyu-protocol                         | https://github.com/tik-choco-lab/wuyu-protocol                                                                    |
| tc-message（Pub/Sub）                 | https://github.com/tik-choco/tc-message                                                                           |
| tik-choco-lab 組織                    | https://github.com/tik-choco-lab                                                                                  |
| fog-zs（開発者）                      | https://github.com/fog-zs                                                                                         |
| 公開シグナリングサーバー              | wss://rtc.tik-choco.com/signaling                                                                                 |
| location-sync 論文                    | https://doi.org/10.57460/vconf.2022.0_101                                                                         |
| fogverse 論文（ICCE-Taiwan 2023）     | https://doi.org/10.1109/ICCE-Taiwan58799.2023.10226934                                                            |
| Loro CRDT 1.0                         | https://loro.dev/blog/v1.0                                                                                        |
| Loro パフォーマンスベンチマーク       | https://loro.dev/docs/performance                                                                                 |
| honeycomb-grid 4.1.5                  | https://github.com/flauwekeul/honeycomb                                                                           |
| gridbugs/wfc                          | https://github.com/gridbugs/wfc                                                                                   |
| hex-map-wfc（Three.js）               | https://github.com/felixturner/hex-map-wfc                                                                        |
| wgsl-noise                            | https://github.com/ZRNOF/wgsl-noise                                                                               |
| wgsl-fns                              | https://github.com/koole/wgsl-fns                                                                                 |
| KayKit Medieval Hexagon Pack（CC0）   | https://kaylousberg.itch.io/kaykit-medieval-hexagon                                                               |
| TSL Transpiler                        | https://threejs.org/examples/webgpu_tsl_transpiler.html                                                           |
| Ed25519 Web Crypto（Chrome）          | https://chromestatus.com/feature/4913922408710144                                                                 |
| Ed25519 ブラウザサポート              | https://blog.ipfs.tech/2025-08-ed25519/                                                                           |

---

## 16. 次のアクション

**今週（Sprint 0 開始前）**

1. `npm create vite@latest mist-world -- --template vanilla-ts` でプロジェクト初期化
2. `npm i @babylonjs/core @babylonjs/loaders @babylonjs/havok @babylonjs/gui` をインストール
3. WebGPUEngine 初期化 + 最小シーン（ヘックス 1 個）描画を確認
4. mistlib WASM を取得し `new MistNode()` → `init()` → `joinRoom()` の接続テストを `wss://rtc.tik-choco.com/signaling` 経由で実施

**Sprint 0（2 週間）**: §9 の 10 項目を順次検証し、全合格で Sprint 1 へ Go。

---

_以上、Mist World 企画書 v7.0。_
