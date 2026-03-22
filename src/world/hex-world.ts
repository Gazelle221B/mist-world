// ---------------------------------------------------------------------------
// HexWorld — macro-grid state for expandable hex world
//
// The world is composed of hex "regions", each a WFC-generated island at a
// macro-level coordinate (macroQ, macroR). Regions can be populated (tiles
// generated) or placeholders (awaiting expansion). Clicking a placeholder
// in Build mode triggers WFC generation for that region.
//
// Macro grid spacing = 2×radius + 1, so outermost tiles of adjacent
// regions are hex-neighbours in world space.
// ---------------------------------------------------------------------------

import { generateIsland, type TileData } from "./wfc-bridge.ts";

const MACRO_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
] as const;

export interface RegionState {
  readonly macroQ: number;
  readonly macroR: number;
  status: "populated" | "placeholder";
  tiles: TileData[] | null;
}

function regionKey(q: number, r: number): string {
  return `${q},${r}`;
}

export class HexWorld {
  private readonly regions = new Map<string, RegionState>();
  private seedHi: number;
  private seedLo: number;
  readonly radius: number;
  readonly spacing: number;

  constructor(radius: number, seedHi: number, seedLo: number) {
    this.radius = radius;
    this.spacing = 2 * radius + 1;
    this.seedHi = seedHi;
    this.seedLo = seedLo;
  }

  /** Initialize: populate center, add ring-1 placeholders. */
  init(): void {
    this.regions.clear();
    this.populateAt(0, 0);
    for (const [dq, dr] of MACRO_DIRS) {
      this.ensurePlaceholder(dq, dr);
    }
  }

  /** Expand a placeholder into a populated region. Returns false if invalid. */
  expand(macroQ: number, macroR: number): boolean {
    const key = regionKey(macroQ, macroR);
    const region = this.regions.get(key);
    if (!region || region.status !== "placeholder") return false;

    this.populateRegion(region);

    // Add placeholders around the newly populated region
    for (const [dq, dr] of MACRO_DIRS) {
      this.ensurePlaceholder(macroQ + dq, macroR + dr);
    }
    return true;
  }

  /** All populated regions. */
  populatedRegions(): RegionState[] {
    return [...this.regions.values()].filter((r) => r.status === "populated");
  }

  /** All placeholder regions. */
  placeholders(): RegionState[] {
    return [...this.regions.values()].filter((r) => r.status === "placeholder");
  }

  /** Number of populated regions. */
  populatedCount(): number {
    return this.populatedRegions().length;
  }

  /** World hex coordinate for a tile within a macro region. */
  tileWorldHex(
    macroQ: number,
    macroR: number,
    tileQ: number,
    tileR: number,
  ): { q: number; r: number } {
    return {
      q: macroQ * this.spacing + tileQ,
      r: macroR * this.spacing + tileR,
    };
  }

  /** Center world hex coordinate for a macro region. */
  regionCenterHex(macroQ: number, macroR: number): { q: number; r: number } {
    return this.tileWorldHex(macroQ, macroR, 0, 0);
  }

  /** Reset world with a new seed. */
  reset(seedHi: number, seedLo: number): void {
    this.seedHi = seedHi;
    this.seedLo = seedLo;
    this.init();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private populateAt(macroQ: number, macroR: number): void {
    const key = regionKey(macroQ, macroR);
    let region = this.regions.get(key);
    if (!region) {
      region = { macroQ, macroR, status: "placeholder", tiles: null };
      this.regions.set(key, region);
    }
    this.populateRegion(region);
  }

  private populateRegion(region: RegionState): void {
    const { hi, lo } = this.deriveSeed(region.macroQ, region.macroR);
    const result = generateIsland(hi, lo, this.radius);
    region.status = "populated";
    region.tiles = result.tiles;
  }

  private ensurePlaceholder(macroQ: number, macroR: number): void {
    const key = regionKey(macroQ, macroR);
    if (!this.regions.has(key)) {
      this.regions.set(key, {
        macroQ,
        macroR,
        status: "placeholder",
        tiles: null,
      });
    }
  }

  /** Deterministic seed derivation from base seed + macro coords. */
  private deriveSeed(
    macroQ: number,
    macroR: number,
  ): { hi: number; lo: number } {
    const hi = (this.seedHi ^ (((macroQ * 0x45d9f3b) | 0) >>> 0)) >>> 0;
    const lo = (this.seedLo ^ (((macroR * 0x119de1f3) | 0) >>> 0)) >>> 0;
    return { hi, lo };
  }
}
