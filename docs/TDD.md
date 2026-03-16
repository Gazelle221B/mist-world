---

# Mist World — Technical Design Document v1.0

**最終更新**: 2026-03-12  
**親文書**: Mist World GDD v7.0（2026-03-12）  
**ステータス**: Pre-Production（Sprint 0 準備完了）  
**作成者**: Solo Developer  
**対象読者**: 実装担当者（= 自分自身）、将来のコントリビュータ

---

## 0. 本文書の目的

GDD で定義された設計意図をコードレベルの実装仕様に落とし込む。本文書に従えば、GDD を読んでいなくても各モジュールの責務、インターフェイス、データフロー、エラーハンドリングが把握できることを目標とする。

---

## 1. プロジェクト構成

### 1.1 ディレクトリレイアウト

```
mist-world/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── assets/
│       └── kaykit/              # KayKit Medieval Hexagon glTF
├── src/
│   ├── main.ts                  # エントリポイント
│   ├── engine/
│   │   ├── EngineFactory.ts     # WebGPU / WebGL2 エンジン生成
│   │   ├── SceneManager.ts      # シーンライフサイクル
│   │   └── RenderConfig.ts      # Tier 判定・品質設定
│   ├── world/
│   │   ├── HexGrid.ts           # honeycomb-grid ラッパー
│   │   ├── TileRegistry.ts      # タイル種別 → glTF マッピング
│   │   ├── ThinInstancePool.ts  # Thin Instance バッファ管理
│   │   ├── WfcBridge.ts         # WASM WFC 呼び出しブリッジ
│   │   └── OceanRenderer.ts     # FFT 海面 ComputeShader
│   ├── net/
│   │   ├── MistBridge.ts        # mistlib WASM ブリッジ
│   │   ├── PeerManager.ts       # ピア接続ライフサイクル
│   │   ├── RpcRouter.ts         # RPC ディスパッチ
│   │   ├── TopologyManager.ts   # トポロジ遷移制御
│   │   └── ViewOnlyGuard.ts     # 品質劣化時フォールバック
│   ├── sync/
│   │   ├── CrdtStore.ts         # Loro LoroDoc ラッパー
│   │   ├── BuildingSync.ts      # 建築物 CRDT 操作
│   │   ├── ChatSync.ts          # チャットログ CRDT 操作
│   │   ├── MetadataSync.ts      # ワールドメタデータ
│   │   ├── OwnershipSync.ts     # オーナーシップテーブル
│   │   └── TrustSync.ts         # トラストスコア
│   ├── avatar/
│   │   ├── AvatarController.ts  # 自分のアバター入力・物理
│   │   ├── RemoteAvatar.ts      # リモートアバター補間描画
│   │   └── AvatarAssets.ts      # アバターモデル管理
│   ├── trust/
│   │   ├── TrustScorer.ts       # スコア計算ロジック
│   │   ├── TrustStore.ts        # trust.toml 永続化
│   │   └── SignatureVerifier.ts # Ed25519 検証
│   ├── audio/
│   │   ├── SpatialAudioManager.ts
│   │   └── VoiceChatBridge.ts
│   ├── storage/
│   │   ├── OpfsManager.ts       # OPFS ラッパー
│   │   ├── MistworldExporter.ts # .mistworld エクスポート
│   │   └── MistworldImporter.ts # .mistworld インポート
│   ├── ui/
│   │   ├── HudOverlay.ts        # HUD
│   │   ├── ChatPanel.ts         # チャット UI
│   │   ├── InviteDialog.ts      # 招待リンク UI
│   │   ├── TrustBadge.ts        # トラストスコア表示
│   │   └── BuildMenu.ts         # 建築メニュー
│   ├── util/
│   │   ├── axialToWorld.ts      # axial → 3D 座標変換
│   │   ├── deterministicHash.ts # 決定論的ハッシュ
│   │   └── logger.ts            # 構造化ロガー
│   └── types/
│       ├── hex.ts               # ヘクス座標型定義
│       ├── network.ts           # ネットワーク型定義
│       ├── crdt.ts              # CRDT 型定義
│       └── mistworld.ts         # .mistworld 型定義
├── rust/
│   ├── mist-wfc/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs           # WASM エクスポート
│   │   │   ├── wfc.rs           # 整数 WFC コア
│   │   │   ├── grid.rs          # ヘクスグリッドデータ構造
│   │   │   ├── tileset.rs       # タイルルール定義
│   │   │   └── rng.rs           # ChaCha8Rng ラッパー
│   │   └── tests/
│   │       └── determinism.rs   # クロスプラットフォーム決定性テスト
│   └── mist-crypto/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs           # Ed25519 WASM フォールバック
├── wgsl/
│   ├── ocean_fft.wgsl           # FFT 海面 ComputeShader
│   ├── hex_terrain.wgsl         # ヘクスタイルシェーダ
│   └── noise.wgsl               # wgsl-noise ポート
└── tests/
    ├── e2e/
    │   └── two-peer-sync.spec.ts
    └── unit/
        ├── HexGrid.test.ts
        ├── CrdtStore.test.ts
        └── TrustScorer.test.ts
```

### 1.2 ビルドパイプライン

ビルドツールは Vite 6.x を使用する。WASM 統合には `vite-plugin-wasm` v3.5.0 を使用し、`wasm-pack` が生成する ESM モジュールを直接 import できるようにする。`vite.config.ts` では `wasm()` プラグインと `topLevelAwait()` プラグインを登録し、`optimizeDeps.exclude` に `loro-crdt` と自作 WASM パッケージを指定する。Rust クレートのビルドは `wasm-pack build --target web --out-dir ../../src/wasm/<crate-name>` で行い、Vite の HMR 対象外として扱う。開発時は `concurrently` で `cargo watch` と `vite dev` を並列起動する。

### 1.3 依存パッケージバージョン固定

npm: `@babylonjs/core` 8.52.x, `@babylonjs/havok` 8.x, `@babylonjs/loaders` 8.52.x, `@babylonjs/materials` 8.52.x, `loro-crdt` 1.10.x, `honeycomb-grid` 4.1.5, `@msgpack/msgpack` 3.1.3, `vite-plugin-wasm` 3.5.0, `vite-plugin-top-level-await` 1.x, `@yoursunny/webcrypto-ed25519` latest。

Rust: `rand_chacha` 0.3.x, `serde` 1.x, `serde_json` 1.x, `wasm-bindgen` 0.2.x, `ed25519-dalek` 2.x, `getrandom` (feature `js`)。

---

## 2. エンジン初期化 — EngineFactory

### 2.1 責務

ブラウザの WebGPU 対応状況を判定し、対応していれば `WebGPUEngine` を、非対応であれば `Engine`（WebGL2）を生成する。生成したエンジンの種別を `RenderConfig` に通知し、以降のレンダリングパイプライン全体の Tier を決定する。

### 2.2 初期化シーケンス

まず `navigator.gpu` の存在を確認する。存在すれば `navigator.gpu.requestAdapter()` を呼び出す。アダプタが取得できれば `WebGPUEngine` を生成し、`await engine.initAsync()` を呼ぶ。この一連の処理のいずれかが失敗した場合、`catch` ブロックで `Engine` コンストラクタに canvas を渡して WebGL2 エンジンを生成する。`Engine` コンストラクタの第 3 引数（`disableWebGL2` フラグ）は `false` とし、WebGL2 を強制する（WebGL1 は非サポート）。WebGL2 も取得できない場合はエラーオーバーレイを表示して処理を終了する。

### 2.3 Tier 定義

Tier A は WebGPU エンジンが起動した場合に割り当てる。ComputeShader 有効、Thin Instance 上限 10,000、物理エンティティ上限 3,000、FFT 海面有効、GPU Picking 有効、ポストプロセスフル。

Tier B は WebGL2 エンジンにフォールバックした場合に割り当てる。ComputeShader 無効（CPU フォールバックまたはスキップ）、Thin Instance 上限 5,000、物理エンティティ上限 1,500、FFT 海面無効（簡易サインウェーブアニメーション）、GPU Picking 無効（CPU レイキャスト）、ポストプロセス簡略化（ブルームのみ）。

### 2.4 RenderConfig インターフェイス

```typescript
interface RenderConfig {
  tier: "A" | "B";
  maxThinInstances: number;
  maxPhysicsEntities: number;
  computeShaderEnabled: boolean;
  gpuPickingEnabled: boolean;
  oceanMode: "fft" | "simple" | "none";
  postProcessLevel: "full" | "reduced" | "none";
}
```

`EngineFactory.create()` は `Promise<{ engine: AbstractEngine; config: RenderConfig }>` を返す。

---

## 3. ワールド生成 — 整数 WFC パイプライン

### 3.1 mist-wfc クレート設計

`mist-wfc` は単一の公開関数 `generate(seed: u64, width: u32, height: u32, tileset: &[u8]) -> Vec<u8>` を WASM にエクスポートする。戻り値は各ヘクスセルのタイル ID（u16）を row-major order で並べたバイト列。

乱数は `ChaCha8Rng::seed_from_u64(seed)` で初期化する。内部のエントロピーヒープは `BTreeMap<u32, Vec<u16>>` で管理し、キーはエントロピー値（整数化した重み合計の逆数）、値は候補セル ID のリスト。浮動小数点演算は一切使用しない。重みは u32 整数として定義し、正規化が必要な箇所では分数演算（分子/分母を個別に u64 で保持）を使用する。

タイルセットは JSON で定義し、`serde_json` でデシリアライズする。各タイルは `id: u16`、`weight: u32`、`adjacency: HashMap<Direction, Vec<u16>>`（6 方向）を持つ。Direction は `NE, E, SE, SW, W, NW` の 6 値 enum。

崩壊不能（contradiction）が発生した場合、そのセルを特殊タイル `VOID`（id = 0）で埋め、処理を続行する。全セル崩壊後に VOID セルが存在すれば、近傍の最頻タイルで置換するフォールバック処理を行う。

### 3.2 WfcBridge（TypeScript 側）

```typescript
class WfcBridge {
  private wasm: typeof import("../wasm/mist-wfc");

  async init(): Promise<void>;
  generate(seed: bigint, width: number, height: number): Uint16Array;
  getWasmHash(): string; // SHA-256 of the WASM binary
}
```

`generate` は WASM 側の `generate` を呼び出し、結果の `Uint8Array` を `Uint16Array` に変換する。`getWasmHash` は初期化時に計算した WASM バイナリの SHA-256 ハッシュを返す（`.mistworld` ファイルの `wasmHash` フィールド用）。

### 3.3 HexGrid — honeycomb-grid 統合

```typescript
import { defineHex, Grid, spiral, rectangle } from "honeycomb-grid";

interface MistHex {
  q: number; // axial q
  r: number; // axial r
  tileId: number; // WFC output tile ID
}

const Hex = defineHex({ dimensions: 1, origin: "topLeft" });

class HexGrid {
  private grid: Grid<typeof Hex>;
  private tileData: Map<string, MistHex>;

  constructor(width: number, height: number);
  setTiles(wfcOutput: Uint16Array): void;
  getTile(q: number, r: number): MistHex | undefined;
  neighbors(q: number, r: number): MistHex[];
  toWorldPosition(q: number, r: number): { x: number; y: number; z: number };
  forEach(callback: (hex: MistHex) => void): void;
}
```

`toWorldPosition` は axial 座標を Babylon.js の world 座標に変換する。フラットトップヘクスの場合、`x = size * (3/2 * q)`, `z = size * (sqrt(3) * (r + q/2))`, `y = 0`（地形高さは別途設定）。`size` はヘクスの外接円半径であり、KayKit アセットの実寸に合わせて調整する（初期値 1.0、Sprint 1 でアセット実測後に確定）。

### 3.4 ThinInstancePool — 大量タイル描画

```typescript
class ThinInstancePool {
  private sourceMeshes: Map<number, Mesh>; // tileId → source mesh
  private matrixBuffers: Map<number, Float32Array>;

  async loadAssets(tileRegistry: TileRegistry): Promise<void>;
  buildFromGrid(hexGrid: HexGrid): void;
  updateTile(q: number, r: number, newTileId: number): void;
  dispose(): void;
}
```

Thin Instance は Babylon.js の `mesh.thinInstanceSetBuffer("matrix", buffer, 16)` API を使用する。KayKit の各タイル種別ごとに 1 つのソースメッシュを用意し、そのタイルが配置されている全ヘクスセルの world 変換行列を 1 つの `Float32Array` にパックする。`buildFromGrid` は WFC 結果から全行列バッファを構築し、一括で `thinInstanceSetBuffer` を呼ぶ。`updateTile` は建築操作時に単一セルの行列を更新する（`thinInstanceSetMatrixAt` で差分更新）。

`loadAssets` は `SceneLoader.ImportMeshAsync` で KayKit glTF を読み込み、タイル ID ごとにソースメッシュを登録する。

---

## 4. P2P ネットワーク — mistlib 統合

### 4.1 MistBridge — WASM ブリッジ

mistlib は Rust/WASM ライブラリとして提供される。TypeScript 側では薄いブリッジクラスを用意する。

```typescript
type DeliveryMode = "reliable" | "unreliable-ordered" | "unreliable";

interface MistConfig {
  signalingUrl: string;
  roomId: string;
  peerId?: string;
}

interface PeerInfo {
  peerId: string;
  position?: Float32Array; // [x, y, z, qx, qy, qz, qw]
}

class MistBridge {
  private wasm: typeof import("../wasm/mistlib");

  async init(config: MistConfig): Promise<void>;
  async joinRoom(): Promise<void>;
  leaveRoom(): void;

  updatePosition(position: Float32Array): void; // 7 floats
  sendMessage(
    target: string | "all" | "others",
    channel: DeliveryMode,
    data: Uint8Array,
  ): void;

  getNeighbors(): PeerInfo[];
  getStats(): { rtt: number; loss: number; bytesIn: number; bytesOut: number };

  onPeerJoined: (callback: (peerId: string) => void) => void;
  onPeerLeft: (callback: (peerId: string) => void) => void;
  onMessage: (callback: (peerId: string, data: Uint8Array) => void) => void;
  onAoiEntered: (callback: (peerId: string) => void) => void;
  onAoiLeft: (callback: (peerId: string) => void) => void;
  onMediaEvent: (
    callback: (peerId: string, track: MediaStreamTrack) => void,
  ) => void;
}
```

### 4.2 PeerManager — ピアライフサイクル

```typescript
class PeerManager {
  private bridge: MistBridge;
  private peers: Map<string, PeerState>;

  connect(config: MistConfig): Promise<void>;
  disconnect(): void;
  getPeer(peerId: string): PeerState | undefined;
  getAllPeers(): PeerState[];
  getPeerCount(): number;

  // 内部イベントハンドリング
  private handleJoin(peerId: string): void;
  private handleLeave(peerId: string): void;
  private handleMessage(peerId: string, data: Uint8Array): void;
}

interface PeerState {
  peerId: string;
  publicKey: CryptoKey | null;
  trustScore: number;
  lastSeen: number;
  rtt: number;
}
```

### 4.3 TopologyManager — トポロジ遷移

トポロジは 3 段階で遷移する。`PeerManager.getPeerCount()` の値を監視し、閾値をまたいだ時点で遷移する。

Stage 1（1〜8 ピア）: フルメッシュ。全ピアが全ピアに直接接続。`updatePosition` は 60 Hz（16.67 ms 間隔）で全ピアに unreliable 送信。CRDT 差分は reliable 送信。

Stage 2（9〜20 ピア）: AOI フィルタリングメッシュ。`updatePosition` の送信先を AOI（Area of Interest、world 座標で半径 R 以内のピア）に限定。送信頻度を 30 Hz に低下。AOI 外のピアには 5 秒間隔で低頻度 heartbeat を送信。

Stage 3（21+ ピア）: スーパーピアリレー。最も安定したピア（最高トラストスコア × 最低 RTT）をスーパーピアとして選出。非スーパーピアはスーパーピアにのみ接続。スーパーピアが中継を担当する。スーパーピア離脱時は次点ピアに自動フェイルオーバー。

```typescript
class TopologyManager {
  private stage: 1 | 2 | 3;

  evaluateTopology(peerCount: number): void;
  getTargetsForPosition(): string[]; // 位置送信先ピア ID リスト
  getTargetsForCrdt(): string[]; // CRDT 送信先ピア ID リスト
  getSuperPeerId(): string | null;
  isViewOnly(): boolean;
}
```

### 4.4 ViewOnlyGuard — 品質劣化フォールバック

`MistBridge.getStats()` を 1 秒間隔でポーリングし、RTT > 500 ms または loss > 20 % が 10 秒間継続した場合、`TopologyManager.isViewOnly()` を `true` に遷移させる。ビューオンリーモードでは建築・チャット送信・投票が無効化され、UI に警告バナーを表示する。RTT < 300 ms かつ loss < 5 % が 10 秒間継続した場合、通常モードに復帰する。

---

## 5. RPC システム — RpcRouter

### 5.1 メッセージフォーマット

全 RPC メッセージは以下の構造を MessagePack でシリアライズして送信する。

```typescript
interface RpcEnvelope {
  type: "rpc";
  method: string;
  args: unknown[];
  callId: number; // monotonic counter
  senderId: string; // peer ID
  signature: Uint8Array; // Ed25519 signature of method + args + callId
}
```

`@msgpack/msgpack` v3.1.3 の `encode` / `decode` を使用する。シリアライズ後のバイト列を `MistBridge.sendMessage` で送信する。

### 5.2 RpcRouter ディスパッチ

```typescript
type RpcHandler = (
  senderId: string,
  ...args: unknown[]
) => void | Promise<void>;

class RpcRouter {
  private handlers: Map<string, RpcHandler>;

  register(method: string, handler: RpcHandler): void;
  unregister(method: string): void;

  // MistBridge.onMessage から呼ばれる
  dispatch(senderId: string, raw: Uint8Array): Promise<void>;

  // 送信ユーティリティ
  callAll(method: string, ...args: unknown[]): void;
  callOthers(method: string, ...args: unknown[]): void;
  callPeer(peerId: string, method: string, ...args: unknown[]): void;
}
```

`dispatch` 内でまず MessagePack デコード → `RpcEnvelope` 型チェック → Ed25519 署名検証 → `handlers.get(method)` でハンドラ呼び出しの順序で処理する。署名検証失敗時は `TrustScorer` に −0.5 ペナルティを通知し、メッセージを破棄する。

### 5.3 登録される RPC メソッド一覧

`spawn` は建築物スポーンを処理する。引数は `(assetId: string, q: number, r: number, rotation: number)`。ハンドラは `BuildingSync.addBuilding` を呼ぶ。

`destroy` は建築物削除を処理する。引数は `(buildingId: string)`。ハンドラは `BuildingSync.removeBuilding` を呼ぶ。

`chat` はチャットメッセージを処理する。引数は `(text: string, timestamp: number)`。ハンドラは `ChatSync.addMessage` を呼ぶ。

`trust_update` はトラストスコア変更を処理する。引数は `(targetPeerId: string, delta: number, reason: string)`。ハンドラは `TrustSync.applyDelta` を呼ぶ。

`crdt_update` は CRDT 差分を処理する。引数は `(update: Uint8Array)`。ハンドラは `CrdtStore.import` を呼ぶ。

`invite_revoke` は招待取り消しを処理する。引数は `(token: string)`。ハンドラは `MetadataSync.revokeInvite` を呼ぶ。

---

## 6. CRDT ストア — Loro 統合

### 6.1 CrdtStore — コアクラス

```typescript
import { LoroDoc, LoroMap, LoroList } from "loro-crdt";

class CrdtStore {
  private doc: LoroDoc;

  // ルートコンテナ
  readonly buildings: LoroList; // LoroList<LoroMap>
  readonly metadata: LoroMap;
  readonly chat: LoroList; // LoroList<LoroMap>
  readonly ownership: LoroMap;
  readonly trust: LoroMap;

  constructor(peerId: bigint) {
    this.doc = new LoroDoc();
    this.doc.setPeerId(peerId);
    this.buildings = this.doc.getList("buildings");
    this.metadata = this.doc.getMap("metadata");
    this.chat = this.doc.getList("chat");
    this.ownership = this.doc.getMap("ownership");
    this.trust = this.doc.getMap("trust");
  }

  // 同期
  exportUpdates(since?: VersionVector): Uint8Array;
  importUpdates(data: Uint8Array): void;
  exportSnapshot(): Uint8Array;
  importSnapshot(data: Uint8Array): void;

  // イベント
  subscribe(callback: (event: LoroEvent) => void): () => void;
  subscribeLocalUpdates(callback: (data: Uint8Array) => void): () => void;

  // 永続化
  async saveToOpfs(opfs: OpfsManager): Promise<void>;
  async loadFromOpfs(opfs: OpfsManager): Promise<boolean>;

  // ユーティリティ
  getVersionVector(): Map<bigint, number>;
  getFrontiers(): OpId[];
  toJSON(): unknown;
}
```

### 6.2 LoroDoc ピア ID の管理

`LoroDoc.setPeerId` には Ed25519 公開鍵のハッシュから導出した u64 を使用する。公開鍵（32 バイト）の先頭 8 バイトを `BigUint64Array` として読み取り、`doc.setPeerId(peerId)` に渡す。これにより Loro のピア ID と暗号学的アイデンティティが紐づく。

### 6.3 BuildingSync — 建築物同期

```typescript
interface BuildingData {
  id: string;        // UUID v4
  assetId: string;   // KayKit model identifier
  q: number;         // axial q
  r: number;         // axial r
  rotation: number;  // 0-5 (60° steps)
  ownerId: string;   // peer ID
  createdAt: number; // UNIX timestamp
}

class BuildingSync {
  constructor(private store: CrdtStore, private hexGrid: HexGrid);

  addBuilding(data: BuildingData): void;
  removeBuilding(buildingId: string): boolean;
  getBuilding(buildingId: string): BuildingData | undefined;
  getAllBuildings(): BuildingData[];
  getBuildingsAt(q: number, r: number): BuildingData[];

  onChange(callback: (added: BuildingData[], removed: string[]) => void): () => void;
}
```

`addBuilding` は内部で `store.buildings` リストに新しい `LoroMap` を push する。LoroMap のキーは `id`, `assetId`, `q`, `r`, `rotation`, `ownerId`, `createdAt`。`removeBuilding` は該当する LoroMap を検索し、リストから削除する（Loro の List.delete）。

`onChange` は `store.doc.subscribe` でイベントを受け取り、`buildings` コンテナの差分を解析して、新規追加と削除をコールバックに通知する。このコールバック内で `ThinInstancePool.updateTile` を呼び、画面に即時反映する。

### 6.4 ChatSync — チャットログ同期

```typescript
interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
}

class ChatSync {
  constructor(private store: CrdtStore);

  addMessage(msg: ChatMessage): void;
  getMessages(limit?: number): ChatMessage[];
  onMessage(callback: (msg: ChatMessage) => void): () => void;
}
```

チャットログは `store.chat` リストに `LoroMap` として追加する。メッセージ数が 1,000 を超えた場合、古いメッセージを先頭から削除する（ローリングウィンドウ）。ただし Loro の CRDT 特性上、削除はトゥームストーンとして残るため、定期的にスナップショットを再生成して履歴を圧縮する。

### 6.5 同期プロトコル

新規ピア参加時の同期フローは以下の通り。新規ピア A がルームに参加すると、既存ピア B が `store.exportSnapshot()` を reliable チャネルで A に送信する。A は `store.importSnapshot(data)` でドキュメントを復元する。以降は双方が `subscribeLocalUpdates` で取得した差分を `crdt_update` RPC で相互に送信する。

差分送信は `subscribeLocalUpdates` コールバックから自動的にトリガーされる。コールバックが返すバイナリデータを `RpcRouter.callOthers('crdt_update', data)` で全ピアに reliable 送信する。

衝突解決は Loro の自動マージに委ねる。同一キーへの同時書き込みは LWW（Last-Writer-Wins）で解決される。建築物リストへの同時 push は順序保持されて両方が追加される。

---

## 7. アバターシステム

### 7.1 AvatarController — ローカルアバター

```typescript
class AvatarController {
  private mesh: AbstractMesh;
  private characterController: PhysicsCharacterController;
  private camera: ArcRotateCamera;

  constructor(scene: Scene, havok: HavokPlugin);

  update(deltaTime: number): void; // 毎フレーム呼び出し
  getTransform(): Float32Array; // [x, y, z, qx, qy, qz, qw]
  dispose(): void;
}
```

Havok の `PhysicsCharacterController` を使用する。WASD キーで移動、スペースでジャンプ、マウスでカメラ回転。`update` 内で入力をサンプリングし、`characterController` に速度を適用する。毎フレーム `getTransform()` の結果を `MistBridge.updatePosition()` に渡す。

### 7.2 RemoteAvatar — リモートアバター補間

```typescript
class RemoteAvatar {
  private mesh: AbstractMesh;
  private targetPosition: Vector3;
  private targetRotation: Quaternion;
  private interpolationFactor: number; // 0.0 ~ 1.0
  private lastUpdateTime: number;

  constructor(scene: Scene, peerId: string);

  applyNetworkUpdate(transform: Float32Array): void;
  update(deltaTime: number): void; // 毎フレーム補間
  setPeerState(state: PeerState): void;
  dispose(): void;
}
```

`applyNetworkUpdate` は受信した位置・回転をターゲットに設定する。`update` は `Vector3.Lerp` と `Quaternion.Slerp` でメッシュを滑らかに移動する。補間係数は `min(1.0, deltaTime * lerpSpeed)` で計算し、`lerpSpeed` は 10.0（100 ms で目標到達）を初期値とする。

ネットワーク更新が 500 ms 以上途絶えた場合、最終速度ベクトルで外挿する（dead reckoning）。1,000 ms 以上途絶えた場合、外挿を停止しアバターを停止させる。

---

## 8. 署名・トラストシステム

### 8.1 SignatureVerifier — Ed25519 検証

```typescript
class SignatureVerifier {
  private nativeSupported: boolean;

  async init(): Promise<void>;

  async generateKeyPair(): Promise<CryptoKeyPair>;
  async sign(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array>;
  async verify(
    publicKey: CryptoKey,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
  async exportPublicKey(key: CryptoKey): Promise<Uint8Array>;
  async importPublicKey(raw: Uint8Array): Promise<CryptoKey>;
}
```

`init` で `crypto.subtle.generateKey('Ed25519', ...)` を試行し、成功すれば `nativeSupported = true`。失敗すれば `@yoursunny/webcrypto-ed25519` をダイナミックインポートし、ポニーフィルを登録する。以降の API は同一インターフェイスで透過的に呼び出せる。

### 8.2 TrustScorer — スコア計算

```typescript
class TrustScorer {
  private scores: Map<string, number>; // peerId → score
  private lastPositiveTick: Map<string, number>;

  getScore(peerId: string): number;
  getLabel(peerId: string): "trusted" | "normal" | "caution" | "blocked";

  applyPenalty(peerId: string, penalty: number, reason: string): void;
  tickPositive(peerId: string): void; // 毎分呼び出し、+0.01
  isBlocked(peerId: string): boolean;

  // 永続化
  exportToToml(): string;
  importFromToml(toml: string): void;
}
```

スコアは `Math.max(0, Math.min(1, currentScore + delta))` でクランプする。ペナルティは即座に適用し、`CrdtStore.trust` にも反映する（他ピアへの参考情報として）。ただし最終的なスコア判定はローカルピアの `TrustScorer` が権威を持つ（他ピアのスコア通知は参考値）。

ブロックされたピア（スコア < 0.2）からのメッセージは `RpcRouter.dispatch` 内で無条件に破棄する。

### 8.3 TrustStore — trust.toml 永続化

```typescript
class TrustStore {
  async save(opfs: OpfsManager, scorer: TrustScorer): Promise<void>;
  async load(opfs: OpfsManager, scorer: TrustScorer): Promise<void>;
}
```

OPFS 上の `trust.toml` ファイルに以下の形式で保存する。

```toml
[peers]
[peers."<peerId>"]
score = 0.85
label = "trusted"
blocked = false
last_seen = 1741776000
```

---

## 9. ストレージ — OPFS 統合

### 9.1 OpfsManager

```typescript
class OpfsManager {
  private root: FileSystemDirectoryHandle;

  async init(): Promise<void>;

  async writeFile(path: string, data: Uint8Array): Promise<void>;
  async readFile(path: string): Promise<Uint8Array | null>;
  async deleteFile(path: string): Promise<boolean>;
  async listFiles(dir: string): Promise<string[]>;
  async fileExists(path: string): Promise<boolean>;
}
```

`init` は `navigator.storage.getDirectory()` でルートハンドルを取得する。`writeFile` は `getFileHandle(name, { create: true })` → `createWritable()` → `write(data)` → `close()` のシーケンスで書き込む。同期的な高速 I/O が必要な場合（自動保存のバックグラウンド処理）は Web Worker 内で `createSyncAccessHandle()` を使用する。

### 9.2 ファイルレイアウト

```
opfs://
├── worlds/
│   └── <roomId>/
│       ├── crdt-snapshot.bin    # Loro スナップショット
│       ├── crdt-updates/
│       │   ├── 0001.bin         # インクリメンタル更新
│       │   ├── 0002.bin
│       │   └── ...
│       └── trust.toml
├── keys/
│   ├── private.key              # Ed25519 秘密鍵 (PKCS8)
│   └── public.key               # Ed25519 公開鍵 (raw)
└── settings.json                # ユーザ設定
```

CRDT スナップショットは 5 分間隔で自動保存する。インクリメンタル更新は `subscribeLocalUpdates` のコールバックごとに連番ファイルとして追記する。アプリ起動時はスナップショットをロード後、連番更新を順次インポートしてドキュメントを最新状態に復元する。スナップショット保存後、対応する連番更新ファイルを削除する。

### 9.3 MistworldExporter / MistworldImporter

```typescript
interface MistworldFile {
  version: "1.0.0";
  seed: string; // u64 decimal string
  wasmHash: string; // SHA-256 hex
  engine: string; // "mist-wfc@0.1.0"
  buildings: string; // Loro snapshot, Base64
  metadata: {
    name: string;
    createdAt: number;
    authorPublicKey: string; // Base64
  };
  trustPolicy: {
    defaultScore: number;
    penalties: Record<string, number>;
  };
  signature: string; // Ed25519 signature, Base64
}

class MistworldExporter {
  async export(
    store: CrdtStore,
    wfcBridge: WfcBridge,
    signer: SignatureVerifier,
    privateKey: CryptoKey,
  ): Promise<Blob>;
}

class MistworldImporter {
  async import(
    file: File | Blob,
    store: CrdtStore,
    wfcBridge: WfcBridge,
    verifier: SignatureVerifier,
  ): Promise<{ valid: boolean; wasmMismatch: boolean }>;
}
```

エクスポート時は `CrdtStore.exportSnapshot()` を Base64 エンコードし、JSON ペイロード全体（signature フィールドを除く）を Ed25519 で署名する。インポート時は署名検証 → `wasmHash` の一致確認（不一致時は `wasmMismatch: true` を返しユーザに確認させる） → `CrdtStore.importSnapshot` の順で処理する。

---

## 10. 海面レンダリング — OceanRenderer

### 10.1 Tier A（WebGPU）— FFT ComputeShader

Popov72/OceanDemo の FFT 実装を参考にする。ComputeShader は `ocean_fft.wgsl` に記述し、Babylon.js の `ComputeShader` クラスで実行する。パラメータは風速、風向、チョッピネス、波の振幅。出力は 256×256 のハイトマップテクスチャと法線テクスチャ。海面メッシュは `CreateGround` で生成し、頂点シェーダでハイトマップをサンプリングして変位させる。

```typescript
class OceanRenderer {
  constructor(scene: Scene, config: RenderConfig);

  async init(): Promise<void>;
  update(time: number): void;
  setWindSpeed(speed: number): void;
  setWindDirection(dir: number): void;
  dispose(): void;
}
```

### 10.2 Tier B（WebGL2）— 簡易波

ComputeShader が使用できないため、CPU 側で 4 つのサインウェーブを合成し、頂点バッファを毎フレーム更新する。メッシュ解像度を 64×64 に制限してパフォーマンスを確保する。法線は差分から近似計算する。

---

## 11. オーディオ — AudioEngineV2 統合

### 11.1 SpatialAudioManager

```typescript
class SpatialAudioManager {
  private engine: AudioEngineV2;
  private slots: Map<string, SpatialSound>; // max 5

  async init(scene: Scene): Promise<void>;

  playAt(soundId: string, position: Vector3, options?: SoundOptions): void;
  stopAll(): void;

  // 距離ヒステリシス
  private evaluateSlots(listenerPosition: Vector3): void;
}
```

最大同時発音数を 5 に制限する。`evaluateSlots` はリスナー位置から各サウンドソースまでの距離を計算し、最も近い 5 つを有効にする。有効化閾値（innerDistance）と無効化閾値（outerDistance）にヒステリシスを設ける（例: innerDistance = 30m, outerDistance = 35m）ことで、境界付近でのサウンドのちらつきを防ぐ。

### 11.2 VoiceChatBridge

```typescript
class VoiceChatBridge {
  private localStream: MediaStream | null;

  async enableMic(): Promise<void>;
  disableMic(): void;
  isMicEnabled(): boolean;

  handleRemoteTrack(peerId: string, track: MediaStreamTrack): void;
}
```

`enableMic` は `navigator.mediaDevices.getUserMedia({ audio: true })` でマイクを取得し、mistlib のメディアトラック API に渡す。`handleRemoteTrack` は受信したトラックを `AudioEngineV2` の空間ノードに接続し、対応するリモートアバターの位置にアタッチする。

---

## 12. 招待リンクシステム

### 12.1 生成

```typescript
class InviteGenerator {
  async generate(
    roomId: string,
    privateKey: CryptoKey,
    expiresIn?: number, // seconds, default 86400 (24h)
  ): Promise<string>;
}
```

ペイロードは `{ roomId, exp: Date.now()/1000 + expiresIn }` を JSON 文字列化し、Ed25519 で署名する。署名とペイロードを Base64url エンコードして `token` パラメータに格納する。URL は `https://mist.world/join?room={roomId}&token={token}&exp={exp}`。

### 12.2 検証

```typescript
class InviteVerifier {
  async verify(
    url: string,
    authorPublicKey: CryptoKey,
  ): Promise<{ valid: boolean; expired: boolean; roomId: string }>;
}
```

クエリパラメータから `token` と `exp` を取得し、`exp` が現在時刻より過去であれば `expired: true` を返す。署名検証は `SignatureVerifier.verify` で行う。検証成功後、`MistBridge.joinRoom()` を呼び出す。

### 12.3 取り消し

招待取り消しは `MetadataSync` 経由で CRDT 上の `revokedTokens`（LoroList）にトークンハッシュを追加することで実現する。新規参加者のトークンが `revokedTokens` に含まれていれば接続を拒否する。

---

## 13. UI 実装方針

UI は Babylon.js GUI（`@babylonjs/gui`）を使用し、HTML DOM には依存しない。これにより将来的な WebXR 対応を容易にする。

**HudOverlay**: 画面左上にミニマップ（ヘクスグリッドの 2D 表示、自分の位置マーカー）、右上に接続状態（ピア数、RTT、Tier 表示）、下部中央にチャット入力欄。

**TrustBadge**: 各リモートアバターの頭上に小さなカラードット（トラストラベルの色）と名前を表示する。`AdvancedDynamicTexture.CreateForMesh` でビルボードとして実装する。

**BuildMenu**: B キーで開く建築メニュー。KayKit アセットのサムネイルをグリッド表示し、選択後にヘクスグリッド上でプレースメントゴーストを表示する。左クリックで確定、右クリックまたは Esc でキャンセル。

**ChatPanel**: 半透明パネルで画面左下に表示。Enter キーで入力モード、送信は Enter、キャンセルは Esc。最新 50 メッセージを表示し、スクロール対応。

---

## 14. エラーハンドリングポリシー

### 14.1 分類

エラーは 3 レベルに分類する。Fatal は処理続行不能でアプリ再起動が必要なもの（WebGL2 未サポート、WASM ロード失敗など）。Recoverable は一時的な障害でリトライまたはフォールバック可能なもの（ネットワーク断、CRDT インポートエラーなど）。Warning はユーザ体験に軽微な影響があるもの（ComputeShader フォールバック、サウンド再生失敗など）。

### 14.2 ハンドリング戦略

Fatal エラーはフルスクリーンオーバーレイで技術的なエラーメッセージ（ユーザ向けに簡略化）を表示し、リロードボタンを提供する。Recoverable エラーはトーストバナーで通知し、自動リトライ（3 回まで、指数バックオフ）を行う。3 回失敗後は手動リトライボタンを表示する。Warning はコンソールログに記録し、必要に応じて HUD に小さなアイコンで表示する。

### 14.3 CRDT 整合性エラー

Loro の import がチェックサム不一致で失敗した場合、そのピアからの更新を拒否し、スナップショットの再送を要求する。3 回連続で失敗した場合、そのピアのトラストスコアに −0.2 ペナルティを適用する。

---

## 15. テスト戦略

### 15.1 ユニットテスト

Vitest を使用する。対象は `HexGrid`（座標変換の正確性）、`TrustScorer`（スコア計算・クランプ・ラベル判定）、`CrdtStore`（LoroDoc の基本操作・スナップショット・復元）、`axialToWorld`（座標変換）、`MistworldExporter/Importer`（JSON 構造・署名検証）。

### 15.2 整数 WFC 決定性テスト

`mist-wfc` の Rust ユニットテストで、同一シードから 100 回生成した結果がバイト単位で一致することを検証する。さらに GitHub Actions の CI で Linux x86_64、macOS ARM64、wasm32-unknown-unknown の 3 ターゲットでビルド・テストし、全ターゲットの出力が一致することを検証する。

### 15.3 E2E テスト

Playwright を使用し、2 つのブラウザタブで同一ルームに接続するテストを実装する。テストシナリオ: 接続確立 → 建築物配置 → 両タブで反映確認 → チャット送信 → 受信確認 → 一方を切断 → 再接続 → CRDT 状態一致確認。

### 15.4 パフォーマンスベンチマーク

Babylon.js の `engine.getFps()` と `scene.getActiveMeshes().length` を 60 秒間サンプリングし、p50/p95/p99 を記録する。4,100 hexes + 8 アバターで p99 fps ≥ 55 を Sprint 1 の完了条件とする。

---

## 16. セキュリティ考慮事項

### 16.1 入力バリデーション

全 RPC メッセージは以下の順序でバリデーションする。MessagePack デコード成功、`type` フィールドが `'rpc'`、`method` が登録済み、引数の型と数が期待通り、`signature` が有効、送信元ピアがブロック済みでない。いずれかが失敗した場合、メッセージを破棄しトラストペナルティを適用する。

### 16.2 WFC 検証

リモートピアが送信した建築データの座標が WFC 出力と矛盾していないかを検証する。具体的には、建築先のヘクスセルが `VOID` でないこと、タイル種別が建築可能カテゴリであることを確認する。矛盾が検出された場合、−0.2 ペナルティを適用しその操作を拒否する。

### 16.3 レート制限

チャットメッセージは 1 秒間に 10 メッセージ超で −0.05 ペナルティ。建築操作は 1 秒間に 5 操作超で −0.05 ペナルティ。RPC 全体で 1 秒間に 100 メッセージ超のピアからの受信を 5 秒間ブロック。

### 16.4 鍵管理

Ed25519 秘密鍵は OPFS に保存し、`crypto.subtle.exportKey('pkcs8', privateKey)` で PKCS8 形式にシリアライズする。鍵は non-extractable として生成するオプションを検討したが、OPFS 永続化のために extractable とする必要がある。代わりに OPFS 自体のオリジン分離に依存し、追加の暗号化層は設けない（ブラウザの Same-Origin ポリシーで保護される）。

---

## 17. パフォーマンスバジェット

### 17.1 フレームバジェット（16.67 ms @ 60 fps）

JavaScript 論理: 2 ms 以内（入力処理、RPC ディスパッチ、CRDT 操作）。物理演算（Havok）: 3 ms 以内。レンダリング（GPU コマンド構築）: 4 ms 以内。GPU 実行: 残り（約 7 ms）。合計 16.67 ms。

### 17.2 メモリバジェット

WASM モジュール合計: 10 MB 以内（mist-wfc ≈ 1 MB, mistlib ≈ 2 MB, Havok ≈ 5 MB, loro-crdt ≈ 3 MB）。JavaScript ヒープ: 50 MB 以内。GPU VRAM: 256 MB 以内。

### 17.3 ネットワークバジェット

前述の GDD §6 の帯域幅見積りに準拠する。初回ロード（HTML + JS + WASM + アセット）は 10 MB 以内（gzip 後）を目標とし、gzip 前でアセット除外のバンドルサイズは 5 MB 以内。

### 17.4 初回ロード最適化

Babylon.js は ES6 Tree-shakable パッケージ（`@babylonjs/core`）を使用し、未使用モジュールを除外する。WASM モジュールは `import()` による遅延ロードを行い、初回レンダリングに必要な最小限（EngineFactory + SceneManager）を先にロードする。KayKit アセットは Vite の `import.meta.glob` でオンデマンドロードする。

---

## 18. 開発ワークフロー

### 18.1 ローカル開発起動手順

```bash
# 1. Rust WASM ビルド
cd rust/mist-wfc && wasm-pack build --target web --out-dir ../../src/wasm/mist-wfc
cd ../mist-crypto && wasm-pack build --target web --out-dir ../../src/wasm/mist-crypto

# 2. mistnet-signaling ローカル起動
cd ../../../mistnet-signaling && go run .

# 3. Vite dev サーバ起動
cd ../mist-world && npm run dev
```

`npm run dev` は内部で `concurrently "cargo watch ..." "vite"` を実行し、Rust ソース変更時に自動リビルドする。

### 18.2 CI パイプライン（GitHub Actions）

Push / PR ごとに以下を実行する。`cargo test --workspace`（Rust ユニットテスト + 決定性テスト）、`wasm-pack build`（3 クレート）、`npm ci && npm run typecheck`（TypeScript 型チェック）、`npm run test`（Vitest ユニットテスト）、`npm run build`（プロダクションビルド、バンドルサイズアサーション付き）。E2E テストは nightly ジョブで実行する。

### 18.3 デプロイ

静的ビルド出力を Cloudflare Pages にデプロイする。`wrangler pages deploy dist/`。カスタムドメイン `mist.world` を Cloudflare DNS で設定する。mistnet-signaling は Fly.io にデプロイする（`fly deploy`、Dockerfile を用意）。

---

## 19. Sprint 0 実装手順（詳細）

### Week 1

**Day 1〜2**: Vite プロジェクト初期化。`package.json` に全依存を追加。`tsconfig.json` を設定（`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`）。`vite.config.ts` に `wasm()` と `topLevelAwait()` を登録。`EngineFactory.ts` を実装し、WebGPU / WebGL2 の初期化を確認。Canvas にグラウンドメッシュとヘミスフェリックライトを表示。

**Day 3**: Rust ワークスペース初期化。`rust/mist-wfc/Cargo.toml` と `rust/mist-crypto/Cargo.toml` を作成。`mist-wfc` の最小 WFC（3×3 グリッド、3 タイル種別）を実装。`wasm-pack build` で WASM を生成し、Vite から `import` できることを確認。

**Day 4〜5**: `WfcBridge.ts` を実装。3×3 WFC の結果を Chrome / Firefox / Safari で実行し、バイト一致を確認。`gridbugs/wfc` v0.10.7 のソースコードを精査し、浮動小数点使用箇所を列挙。フォーク改修の工数を見積もる。

### Week 2

**Day 6〜7**: mistlib WASM を Vite にインポート。`MistBridge.ts` の `init` / `joinRoom` を実装。ローカル signaling サーバ経由で 2 タブ接続を確認。`updatePosition` 60 Hz 送信テスト。RTT を `getStats` で計測。

**Day 8〜9**: `CrdtStore.ts` を実装。2 タブ間で `LoroMap` の同時編集 → マージ → 結果一致を確認。`OpfsManager.ts` を実装し、スナップショットの保存・復元を確認。

**Day 10**: `SignatureVerifier.ts` を実装。Ed25519 キーペア生成 → 署名 → 検証を Chrome / Firefox / Safari で確認。非対応ブラウザエミュレーションでポニーフィルフォールバックを確認。Go/No-Go 判定会議（自分自身とのチェックリストレビュー）。

---

## 20. 用語集

**Axial Coordinates**: ヘクスグリッドの 2 軸座標系（q, r）。Red Blob Games の cube coordinates から s 軸を省略した形式。

**AOI (Area of Interest)**: 空間的に近いピアのみにデータを送信するフィルタリング手法。

**Dead Reckoning**: ネットワーク更新が途絶えた際に、最終速度ベクトルで位置を外挿する手法。

**Thin Instance**: Babylon.js の描画最適化手法。同一メッシュを異なるワールド行列で大量描画する。各インスタンスは個別のメッシュオブジェクトを持たず、行列バッファのみで管理される。

**Shallow Snapshot**: Loro の機能。CRDT の現在の状態のみをエクスポートし、操作履歴を含めない。インポートが高速。

**LWW (Last-Writer-Wins)**: 同一キーへの同時書き込みが衝突した場合、タイムスタンプが最新の操作が勝つ CRDT の解決戦略。

**OPFS (Origin Private File System)**: ブラウザ提供のオリジン分離されたプライベートファイルシステム。IndexedDB よりファイルベースのアクセスに適している。

---

_— End of Document —_
