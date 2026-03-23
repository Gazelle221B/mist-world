// ---------------------------------------------------------------------------
// HexWorld — macro-grid state for expandable hex world
//
// The world is composed of hex "regions", each a WFC-generated island at a
// macro-level coordinate (macroQ, macroR). Regions can be populated (tiles
// generated) or placeholders (awaiting expansion). Clicking a placeholder
// in Build mode triggers WFC generation for that region.
//
// Seam constraints: when expanding a region adjacent to already-populated
// regions, the boundary edges of existing tiles become fixed constraints
// for the new region's WFC solve, ensuring seamless terrain transitions.
//
// Macro grid spacing = 2×radius + 1, so outermost tiles of adjacent
// regions are hex-neighbours in world space.
// ---------------------------------------------------------------------------

import {
  type BoundaryConstraint,
  edgeAt,
  generateIsland,
  generateIslandConstrained,
  HEX_DIRS,
  hexSpiral,
  type TileData,
} from "./wfc-bridge.ts";

const MACRO_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
] as const;

/** A tile with world-space hex coordinates (not local to a region). */
export interface WorldTile extends TileData {
  worldQ: number;
  worldR: number;
}

export interface RegionState {
  readonly macroQ: number;
  readonly macroR: number;
  status: "populated" | "placeholder";
  tiles: TileData[] | null;
  boundaryFixCount: number;
}

function regionKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Hex (axial) distance between two cells. */
function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function buildRingOffsetMap(radius: number): Map<string, number> {
  const ring = new Map<string, number>();
  if (radius <= 0) return ring;

  let q = -radius;
  let r = 0;

  for (const [dq, dr] of HEX_DIRS) {
    for (let offset = 0; offset < radius; offset++) {
      ring.set(`${q},${r}`, offset);
      q += dq;
      r += dr;
    }
  }

  return ring;
}

export class HexWorld {
  private readonly regions = new Map<string, RegionState>();
  private readonly _globalTiles = new Map<string, WorldTile>();
  private seedHi: number;
  private seedLo: number;
  readonly radius: number;
  /** WFC solve radius — one ring larger to cover 3-way junction gaps. */
  readonly solveRadius: number;
  readonly spacing: number;

  /** Cached set of local coords for the solve radius. */
  private readonly solveCoordSet: Set<string>;
  /** Offset index for each cell on the outer solve ring. */
  private readonly solveRingOffsets: Map<string, number>;

  constructor(radius: number, seedHi: number, seedLo: number) {
    this.radius = radius;
    this.solveRadius = radius + 1;
    this.spacing = 2 * radius + 1;
    this.seedHi = seedHi;
    this.seedLo = seedLo;

    // Pre-compute the set of local coordinates for the solve area
    this.solveCoordSet = new Set(
      hexSpiral(this.solveRadius).map(([q, r]) => `${q},${r}`),
    );
    this.solveRingOffsets = buildRingOffsetMap(this.solveRadius);
  }

  /** Initialize: populate center, add ring-1 placeholders. */
  init(): void {
    this.regions.clear();
    this._globalTiles.clear();
    this.populateAt(0, 0);
    for (const [dq, dr] of MACRO_DIRS) {
      this.ensurePlaceholder(dq, dr);
    }
  }

  /**
   * Expand a placeholder into a populated region.
   * Returns the newly added WorldTiles (empty array if invalid).
   */
  expand(macroQ: number, macroR: number): WorldTile[] {
    const key = regionKey(macroQ, macroR);
    const region = this.regions.get(key);
    if (!region || region.status !== "placeholder") return [];

    // Snapshot existing keys so we only return truly new tiles
    const existingKeys = new Set(this._globalTiles.keys());
    this.populateRegion(region);

    // Collect only the tiles that were newly added
    const newTiles: WorldTile[] = [];
    for (const [key, wt] of this._globalTiles) {
      if (!existingKeys.has(key)) newTiles.push(wt);
    }

    // Add placeholders around the newly populated region
    for (const [dq, dr] of MACRO_DIRS) {
      this.ensurePlaceholder(macroQ + dq, macroR + dr);
    }
    return newTiles;
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

  /** All tiles across all populated regions, in world coordinates. */
  allTiles(): WorldTile[] {
    return [...this._globalTiles.values()];
  }

  /** Total tile count in the global map (excludes VOIDs). */
  globalTileCount(): number {
    return this._globalTiles.size;
  }

  /** Count VOID tiles across all regions (not in globalTiles). */
  totalVoidCount(): number {
    let count = 0;
    for (const region of this.regions.values()) {
      if (region.status !== "populated" || !region.tiles) continue;
      for (const tile of region.tiles) {
        if (tile.terrain === 255) count++;
      }
    }
    return count;
  }

  /** Total boundary fixes across all constrained generations. */
  totalBoundaryFixes(): number {
    let total = 0;
    for (const region of this.regions.values()) {
      total += region.boundaryFixCount;
    }
    return total;
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
  // Boundary constraint extraction
  // -----------------------------------------------------------------------

  /**
   * Extract boundary constraints for a new region at (macroQ, macroR)
   * from all populated neighbours.
   *
   * For each tile in each populated neighbour, check if any of its 6
   * hex-direction neighbours fall within the new region's local coord
   * space. If so, emit a BoundaryConstraint with the existing tile's
   * edge type at that direction.
   */
  extractBoundaryConstraints(
    macroQ: number,
    macroR: number,
  ): BoundaryConstraint[] {
    const constraints: BoundaryConstraint[] = [];
    const newOriginQ = macroQ * this.spacing;
    const newOriginR = macroR * this.spacing;

    for (const [dq, dr] of MACRO_DIRS) {
      const nQ = macroQ + dq;
      const nR = macroR + dr;
      const key = regionKey(nQ, nR);
      const neighbor = this.regions.get(key);
      if (!neighbor || neighbor.status !== "populated" || !neighbor.tiles) {
        continue;
      }

      const nOriginQ = nQ * this.spacing;
      const nOriginR = nR * this.spacing;

      for (const tile of neighbor.tiles) {
        if (tile.terrain === 255) continue;

        const worldQ = nOriginQ + tile.q;
        const worldR = nOriginR + tile.r;

        for (let d = 0; d < 6; d++) {
          const adjWorldQ = worldQ + HEX_DIRS[d][0];
          const adjWorldR = worldR + HEX_DIRS[d][1];

          // Convert to new region's local coords
          const localQ = adjWorldQ - newOriginQ;
          const localR = adjWorldR - newOriginR;

          if (this.solveCoordSet.has(`${localQ},${localR}`)) {
            const existingEdge = edgeAt(
              tile.prototypeId,
              d,
              tile.rotation,
            );
            constraints.push({
              q: localQ,
              r: localR,
              dir: (d + 3) % 6,
              edge_type: existingEdge,
            });
          }
        }
      }
    }

    // Sort for deterministic ordering (independent of Map iteration order)
    constraints.sort((a, b) =>
      a.q !== b.q ? a.q - b.q :
      a.r !== b.r ? a.r - b.r :
      a.dir - b.dir
    );

    return constraints;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private populateAt(macroQ: number, macroR: number): void {
    const key = regionKey(macroQ, macroR);
    let region = this.regions.get(key);
    if (!region) {
      region = {
        macroQ,
        macroR,
        status: "placeholder",
        tiles: null,
        boundaryFixCount: 0,
      };
      this.regions.set(key, region);
    }
    this.populateRegion(region);
  }

  private populateRegion(region: RegionState): void {
    const { hi, lo } = this.deriveSeed(region.macroQ, region.macroR);
    const constraints = this.extractBoundaryConstraints(
      region.macroQ,
      region.macroR,
    );

    const result = constraints.length > 0
      ? generateIslandConstrained(hi, lo, this.solveRadius, constraints)
      : generateIsland(hi, lo, this.solveRadius);

    region.status = "populated";
    region.tiles = result.tiles;
    region.boundaryFixCount = result.boundaryFixCount;

    // Merge only owned cells into the global tile map
    for (const tile of result.tiles) {
      if (tile.terrain === 255) continue; // skip VOID
      const wq = region.macroQ * this.spacing + tile.q;
      const wr = region.macroR * this.spacing + tile.r;

      if (!this.isOwnedLocalCell(tile.q, tile.r)) continue;
      // Skip if another region already claimed this cell
      if (this._globalTiles.has(`${wq},${wr}`)) continue;

      this._globalTiles.set(`${wq},${wr}`, {
        ...tile,
        q: wq,
        r: wr,
        worldQ: wq,
        worldR: wr,
      });
    }
  }

  /**
   * Determine whether a local cell belongs to this region's visible footprint.
   *
   * The region always owns its visible-radius core. On the outer solve ring it
   * owns cells that are strictly closer to this region than to any neighbour,
   * plus one deterministic tie cell per side. This keeps the footprint
   * symmetric while filling the 3-way junction pockets between regions.
   */
  private isOwnedLocalCell(localQ: number, localR: number): boolean {
    const d0 = hexDistance(localQ, localR, 0, 0);
    if (d0 <= this.radius) return true;
    if (d0 > this.solveRadius) return false;

    let minNeighbor = Infinity;
    for (const [dq, dr] of MACRO_DIRS) {
      const d = hexDistance(
        localQ,
        localR,
        dq * this.spacing,
        dr * this.spacing,
      );
      if (d < minNeighbor) minNeighbor = d;
    }

    if (d0 < minNeighbor) return true;
    if (d0 > minNeighbor) return false;

    const offset = this.solveRingOffsets.get(`${localQ},${localR}`);
    return offset === this.solveRadius - 1;
  }

  private ensurePlaceholder(macroQ: number, macroR: number): void {
    const key = regionKey(macroQ, macroR);
    if (!this.regions.has(key)) {
      this.regions.set(key, {
        macroQ,
        macroR,
        status: "placeholder",
        tiles: null,
        boundaryFixCount: 0,
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
