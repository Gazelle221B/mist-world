/* tslint:disable */
/* eslint-disable */

export function engine_version(): string;

/**
 * Generate a hex island using prototype-based integer WFC.
 *
 * `radius` controls how many hex rings to generate:
 *   0 → 1 tile, 1 → 7 tiles, 2 → 19 tiles, 3 → 37 tiles, etc.
 */
export function generate(seed_hi: number, seed_lo: number, radius: number): string;

/**
 * Generate a hex island with boundary constraints from neighbouring regions.
 *
 * `constraints_json` is a JSON array of `{ q, r, dir, edge_type }` objects
 * specifying edge constraints from already-populated neighbours.
 */
export function generate_constrained(seed_hi: number, seed_lo: number, radius: number, constraints_json: string): string;

/**
 * Legacy preview — kept for backwards compatibility.
 */
export function generate_preview(seed_hi: number, seed_lo: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly engine_version: () => [number, number];
    readonly generate: (a: number, b: number, c: number) => [number, number];
    readonly generate_constrained: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly generate_preview: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
