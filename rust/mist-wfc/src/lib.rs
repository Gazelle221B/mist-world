// ---------------------------------------------------------------------------
// mist-wfc — Integer-only Wave Function Collapse for hexagonal grids
//
// Critical constraints (from project rules):
//   • No floating-point arithmetic anywhere in this crate
//   • ChaCha8Rng for all randomness
//   • BTreeMap for deterministic iteration order
// ---------------------------------------------------------------------------

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

// ---------------------------------------------------------------------------
// Hex coordinate helpers (axial)
// ---------------------------------------------------------------------------

/// Six axial direction offsets: NE, E, SE, SW, W, NW
const HEX_DIRS: [(i32, i32); 6] = [
    (1, -1),  // 0: NE
    (1, 0),   // 1: E
    (0, 1),   // 2: SE
    (-1, 1),  // 3: SW
    (-1, 0),  // 4: W
    (0, -1),  // 5: NW
];

/// Generate all axial coordinates for a hex ring of given radius.
fn hex_ring(radius: i32) -> Vec<(i32, i32)> {
    if radius == 0 {
        return vec![(0, 0)];
    }
    let mut coords = Vec::with_capacity(6 * radius as usize);
    let mut q = radius;
    let mut r = -radius;
    for dir_idx in 0..6 {
        let (dq, dr) = HEX_DIRS[(dir_idx + 2) % 6];
        for _ in 0..radius {
            coords.push((q, r));
            q += dq;
            r += dr;
        }
    }
    coords
}

/// Generate all axial coordinates up to (and including) the given radius.
fn hex_spiral(radius: i32) -> Vec<(i32, i32)> {
    let mut coords = vec![(0, 0)];
    for ring in 1..=radius {
        coords.extend(hex_ring(ring));
    }
    coords
}

// ---------------------------------------------------------------------------
// Terrain & edge types (integer-only)
// ---------------------------------------------------------------------------

/// Terrain / edge IDs:
///   0 = grass, 1 = sand, 2 = rock, 3 = shallow water, 4 = forest,
///   5 = deep water
///   255 = VOID (sentinel — contradiction marker, never changes)
#[allow(dead_code)]
const TERRAIN_GRASS: u8 = 0;
#[allow(dead_code)]
const TERRAIN_SAND: u8 = 1;
#[allow(dead_code)]
const TERRAIN_ROCK: u8 = 2;
#[allow(dead_code)]
const TERRAIN_SHALLOW: u8 = 3;
#[allow(dead_code)]
const TERRAIN_FOREST: u8 = 4;
#[allow(dead_code)]
const TERRAIN_DEEP: u8 = 5;
const TERRAIN_VOID: u8 = 255;

/// Number of placeable terrain / edge types (excludes VOID).
const TERRAIN_COUNT: usize = 6;

/// Edge compatibility table: `ADJ_WEIGHTS[edge_a][edge_b]` is the integer
/// weight expressing how strongly edge_a supports edge_b as a neighbour.
/// Weight 0 = hard prohibition (propagation eliminates the candidate).
///
/// This replaces the old terrain-level adjacency table with an edge-level
/// one. The semantics are identical — edge types mirror terrain types.
///
/// Deep water edges (5) use weight=0 for all non-water edges (hard rule).
/// Shallow water edges (3) use weight=1 for land edges ("strongly avoids").
const ADJ_WEIGHTS: [[u32; TERRAIN_COUNT]; TERRAIN_COUNT] = [
    // to:  grass  sand  rock  shlw  forest  deep
    [  10,    8,    4,    1,    8,    0 ],  // from grass  (0)
    [   5,    6,    3,   10,    3,    0 ],  // from sand   (1)
    [   4,    3,   10,    1,    6,    0 ],  // from rock   (2)
    [   1,   10,    1,   10,    1,   12 ],  // from shallow(3)
    [   8,    3,    6,    1,   10,    0 ],  // from forest (4)
    [   0,    0,    0,   12,    0,   14 ],  // from deep   (5)
];

// ---------------------------------------------------------------------------
// Tile Prototypes
// ---------------------------------------------------------------------------

/// A tile prototype defines the terrain type, edge configuration, base
/// weight, and height modifier for a hex tile variant.
///
/// The WFC operates over (prototype_id, rotation) pairs as candidates.
/// Edges determine adjacency compatibility via ADJ_WEIGHTS.
struct TilePrototype {
    terrain: u8,
    edges: [u8; 6],   // edge type per logical direction (NE..NW)
    weight: u32,       // base weight for selection
    level_delta: i8,   // height modifier (integer, added to base elevation)
}

const PROTO_COUNT: usize = 8;

/// Prototype definitions:
///   0 = GRASS_FULL       — uniform grass
///   1 = SAND_FULL        — uniform sand
///   2 = ROCK_FULL        — uniform rock
///   3 = FOREST_FULL      — uniform forest
///   4 = SHALLOW_FULL     — uniform shallow water
///   5 = DEEP_FULL        — uniform deep water
///   6 = COAST_STRAIGHT   — sand/shallow transition (3+3 split)
///   7 = COAST_CORNER     — sand/shallow transition (4+2 split)
const PROTOTYPES: [TilePrototype; PROTO_COUNT] = [
    TilePrototype { terrain: 0, edges: [0, 0, 0, 0, 0, 0], weight: 5, level_delta: 0 },
    TilePrototype { terrain: 1, edges: [1, 1, 1, 1, 1, 1], weight: 5, level_delta: 0 },
    TilePrototype { terrain: 2, edges: [2, 2, 2, 2, 2, 2], weight: 3, level_delta: 0 },
    TilePrototype { terrain: 4, edges: [4, 4, 4, 4, 4, 4], weight: 4, level_delta: 0 },
    TilePrototype { terrain: 3, edges: [3, 3, 3, 3, 3, 3], weight: 4, level_delta: 0 },
    TilePrototype { terrain: 5, edges: [5, 5, 5, 5, 5, 5], weight: 3, level_delta: 0 },
    TilePrototype { terrain: 1, edges: [1, 1, 1, 3, 3, 3], weight: 3, level_delta: 0 },
    TilePrototype { terrain: 1, edges: [1, 1, 1, 1, 3, 3], weight: 2, level_delta: 0 },
];

/// Total candidate states = prototypes × 6 rotations.
/// Fits in a u64 bitmask (48 ≤ 64).
const TOTAL_CANDIDATES: usize = PROTO_COUNT * 6; // 48

/// Encode a (prototype_index, rotation) pair into a candidate index.
fn encode(proto_idx: usize, rotation: usize) -> usize {
    proto_idx * 6 + rotation
}

/// Decode a candidate index into (prototype_index, rotation).
fn decode(cand: usize) -> (usize, usize) {
    (cand / 6, cand % 6)
}

/// Get the edge type at physical direction `dir` for a prototype with
/// rotation `rot`. When rotated CW by `rot` steps, logical edge i moves
/// to physical direction (i + rot) % 6, so the edge at physical direction
/// `dir` is the logical edge at `(dir - rot + 6) % 6`.
fn edge_at(proto: &TilePrototype, dir: usize, rot: usize) -> u8 {
    proto.edges[(dir + 6 - rot) % 6]
}

// ---------------------------------------------------------------------------
// Boundary constraints (for seam-aware expansion)
// ---------------------------------------------------------------------------

/// A boundary constraint from an already-populated neighbouring region.
/// Tells the WFC: "the tile at local (q, r), looking in direction `dir`,
/// has an existing neighbour whose touching edge is `edge_type`."
#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
struct BoundaryConstraint {
    q: i32,
    r: i32,
    dir: usize,
    edge_type: u8,
}

/// Pre-filter candidates on cells that have boundary constraints.
/// Returns the number of cells whose candidate set was narrowed.
fn apply_boundary_constraints(
    constraints: &[BoundaryConstraint],
    coord_to_idx: &BTreeMap<(i32, i32), usize>,
    cells: &mut [Cell],
) -> usize {
    let mut fix_count: usize = 0;
    for bc in constraints {
        let Some(&idx) = coord_to_idx.get(&(bc.q, bc.r)) else {
            continue;
        };
        let cell = &mut cells[idx];
        if cell.collapsed {
            continue;
        }

        let mut new_mask: u64 = 0;
        let mut new_count: u32 = 0;

        for cand in 0..TOTAL_CANDIDATES {
            if cell.candidates & (1_u64 << cand) == 0 {
                continue;
            }
            let (p_idx, rot) = decode(cand);
            let my_edge = edge_at(&PROTOTYPES[p_idx], bc.dir, rot);
            // The existing neighbour has edge `bc.edge_type` facing us;
            // we need ADJ_WEIGHTS[bc.edge_type][my_edge] > 0.
            if ADJ_WEIGHTS[bc.edge_type as usize][my_edge as usize] > 0 {
                new_mask |= 1_u64 << cand;
                new_count += 1;
            }
        }

        if new_mask != cell.candidates {
            cell.candidates = new_mask;
            cell.count = new_count;
            fix_count += 1;
        }
    }
    fix_count
}

// ---------------------------------------------------------------------------
// WFC core (prototype-based, integer entropy)
// ---------------------------------------------------------------------------

/// Per-cell state during WFC collapse.
#[derive(Clone)]
struct Cell {
    /// Remaining candidates as a bitmask (bit i = candidate i is possible).
    candidates: u64,
    /// Number of remaining candidates (integer entropy).
    count: u32,
    /// Whether this cell has been collapsed.
    collapsed: bool,
    /// Assigned terrain (valid only when collapsed).
    terrain: u8,
    /// Assigned prototype index (valid only when collapsed).
    proto_id: u8,
    /// Assigned rotation 0..5 (valid only when collapsed).
    rotation: u8,
    /// Order in which this cell was collapsed (0-based).
    collapse_order: u32,
}

impl Cell {
    fn new() -> Self {
        Self {
            candidates: (1_u64 << TOTAL_CANDIDATES) - 1, // bits 0..47 set
            count: TOTAL_CANDIDATES as u32,
            collapsed: false,
            terrain: 0,
            proto_id: 0,
            rotation: 0,
            collapse_order: 0,
        }
    }
}

/// Adjacency list entry: (neighbour_cell_index, direction_from_self 0..5).
type AdjList = Vec<Vec<(usize, usize)>>;

/// Shared setup: build coordinate index and adjacency lists.
fn wfc_setup(
    coords: &[(i32, i32)],
) -> (BTreeMap<(i32, i32), usize>, AdjList, Vec<Cell>) {
    let coord_to_idx: BTreeMap<(i32, i32), usize> = coords
        .iter()
        .enumerate()
        .map(|(i, &c)| (c, i))
        .collect();

    let adj: AdjList = coords
        .iter()
        .map(|&(q, r)| {
            HEX_DIRS
                .iter()
                .enumerate()
                .filter_map(|(dir, &(dq, dr))| {
                    coord_to_idx
                        .get(&(q + dq, r + dr))
                        .map(|&ni| (ni, dir))
                })
                .collect()
        })
        .collect();

    let cells = vec![Cell::new(); coords.len()];
    (coord_to_idx, adj, cells)
}

/// Main WFC collapse loop. Operates on pre-initialised cells.
fn wfc_main_loop(cells: &mut [Cell], adj: &AdjList, rng: &mut ChaCha8Rng) {
    let n = cells.len();
    let mut collapsed_count: usize = 0;

    while collapsed_count < n {
        // 1. Find uncollapsed cell with minimum entropy.
        let mut min_count = u32::MAX;
        let mut min_candidates: Vec<usize> = Vec::new();

        for (i, cell) in cells.iter().enumerate() {
            if cell.collapsed {
                continue;
            }
            if cell.count < min_count {
                min_count = cell.count;
                min_candidates.clear();
                min_candidates.push(i);
            } else if cell.count == min_count {
                min_candidates.push(i);
            }
        }

        if min_candidates.is_empty() {
            break;
        }

        // Deterministic tie-break
        let pick_idx = (rng.next_u32() as usize) % min_candidates.len();
        let cell_idx = min_candidates[pick_idx];

        // 2. Contradiction check
        if cells[cell_idx].count == 0 {
            cells[cell_idx].collapsed = true;
            cells[cell_idx].terrain = TERRAIN_VOID;
            cells[cell_idx].proto_id = 0;
            cells[cell_idx].rotation = 0;
            cells[cell_idx].collapse_order = collapsed_count as u32;
            collapsed_count += 1;
            continue; // no propagation for VOID
        }

        // 3. Collapse: pick a candidate weighted by edge context.
        match pick_candidate(&cells[cell_idx], &adj[cell_idx], cells, rng) {
            Some((p_idx, rot)) => {
                let proto = &PROTOTYPES[p_idx];
                cells[cell_idx].collapsed = true;
                cells[cell_idx].terrain = proto.terrain;
                cells[cell_idx].proto_id = p_idx as u8;
                cells[cell_idx].rotation = rot as u8;
                cells[cell_idx].collapse_order = collapsed_count as u32;
                cells[cell_idx].candidates = 1_u64 << encode(p_idx, rot);
                cells[cell_idx].count = 1;
                collapsed_count += 1;

                // 4. Propagate constraints
                propagate(cell_idx, adj, cells);
            }
            None => {
                // Contradiction during pick
                cells[cell_idx].collapsed = true;
                cells[cell_idx].terrain = TERRAIN_VOID;
                cells[cell_idx].proto_id = 0;
                cells[cell_idx].rotation = 0;
                cells[cell_idx].collapse_order = collapsed_count as u32;
                collapsed_count += 1;
            }
        }
    }
}

/// Run unconstrained WFC on a hex grid.
/// Returns (terrain, prototype_id, rotation, collapse_order) per cell.
fn wfc_collapse(coords: &[(i32, i32)], rng: &mut ChaCha8Rng) -> Vec<(u8, u8, u8, u32)> {
    let (_coord_to_idx, adj, mut cells) = wfc_setup(coords);
    wfc_main_loop(&mut cells, &adj, rng);
    cells
        .iter()
        .map(|c| (c.terrain, c.proto_id, c.rotation, c.collapse_order))
        .collect()
}

/// Run WFC with boundary constraints from neighbouring regions.
/// Returns ((terrain, proto_id, rotation, collapse_order) per cell, fix_count).
fn wfc_collapse_constrained(
    coords: &[(i32, i32)],
    rng: &mut ChaCha8Rng,
    constraints: &[BoundaryConstraint],
) -> (Vec<(u8, u8, u8, u32)>, usize) {
    let (coord_to_idx, adj, mut cells) = wfc_setup(coords);

    // Apply boundary constraints before the main loop
    let fix_count = apply_boundary_constraints(constraints, &coord_to_idx, &mut cells);

    // Propagate from all constrained cells to cascade restrictions
    // Use a BTreeSet to collect unique constrained cell indices for determinism
    let mut constrained_indices: Vec<usize> = constraints
        .iter()
        .filter_map(|bc| coord_to_idx.get(&(bc.q, bc.r)).copied())
        .collect();
    constrained_indices.sort_unstable();
    constrained_indices.dedup();
    for &idx in &constrained_indices {
        propagate(idx, &adj, &mut cells);
    }

    wfc_main_loop(&mut cells, &adj, rng);

    let results = cells
        .iter()
        .map(|c| (c.terrain, c.proto_id, c.rotation, c.collapse_order))
        .collect();
    (results, fix_count)
}

/// Pick a candidate from the cell's remaining options, weighted by
/// prototype base weight and edge compatibility with neighbours.
///
/// Weight formula (integer only):
///   weight = proto.weight × (1 + adj_sum)
///
/// adj_sum uses unique edge contributions from each neighbour to avoid
/// inflating weights when a neighbour has many rotationally-equivalent
/// candidates.
fn pick_candidate(
    cell: &Cell,
    adj: &[(usize, usize)],
    all_cells: &[Cell],
    rng: &mut ChaCha8Rng,
) -> Option<(usize, usize)> {
    let mut weights = [0_u32; TOTAL_CANDIDATES];

    for cand in 0..TOTAL_CANDIDATES {
        if cell.candidates & (1_u64 << cand) == 0 {
            continue;
        }

        let (p_idx, rot) = decode(cand);
        let proto = &PROTOTYPES[p_idx];

        let mut adj_sum: u32 = 0;

        for &(ni, dir) in adj {
            let my_edge = edge_at(proto, dir, rot);
            let ncell = &all_cells[ni];
            let opp = (dir + 3) % 6;

            if ncell.collapsed {
                let n_edge = edge_at(
                    &PROTOTYPES[ncell.proto_id as usize],
                    opp,
                    ncell.rotation as usize,
                );
                adj_sum = adj_sum
                    .saturating_add(ADJ_WEIGHTS[n_edge as usize][my_edge as usize]);
            } else {
                // Collect unique edge types from neighbour's candidates
                let mut seen = [false; TERRAIN_COUNT];
                for nc in 0..TOTAL_CANDIDATES {
                    if ncell.candidates & (1_u64 << nc) == 0 {
                        continue;
                    }
                    let (np, nr) = decode(nc);
                    seen[edge_at(&PROTOTYPES[np], opp, nr) as usize] = true;
                }
                for (edge, &present) in seen.iter().enumerate() {
                    if present {
                        adj_sum = adj_sum
                            .saturating_add(ADJ_WEIGHTS[edge][my_edge as usize]);
                    }
                }
            }
        }

        weights[cand] = proto.weight.saturating_mul(1_u32.saturating_add(adj_sum));
    }

    // Weighted random selection (integer only)
    let total: u32 = weights.iter().sum();
    if total == 0 {
        return None;
    }

    let mut roll = rng.next_u32() % total;
    for (cand, &w) in weights.iter().enumerate() {
        if roll < w {
            return Some(decode(cand));
        }
        roll -= w;
    }

    None
}

/// Propagate constraints using arc-consistency (AC-3 style).
///
/// When a cell's candidates change, its neighbours are re-checked:
/// a neighbour candidate is removed if NO remaining candidate in the
/// source cell can support it via edge compatibility.
fn propagate(start: usize, adj: &AdjList, cells: &mut [Cell]) {
    let n = cells.len();
    let mut queue = vec![start];
    let mut in_queue = vec![false; n];
    in_queue[start] = true;

    while let Some(idx) = queue.pop() {
        in_queue[idx] = false;

        for &(ni, dir) in &adj[idx] {
            if cells[ni].collapsed {
                continue;
            }

            let opp = (dir + 3) % 6;
            let mut changed = false;

            for cand_ni in 0..TOTAL_CANDIDATES {
                if cells[ni].candidates & (1_u64 << cand_ni) == 0 {
                    continue;
                }

                let (p_ni, r_ni) = decode(cand_ni);
                let edge_ni = edge_at(&PROTOTYPES[p_ni], opp, r_ni);

                // Check: is there any remaining candidate in cells[idx]
                // whose edge at `dir` is compatible with edge_ni?
                let supported = if cells[idx].collapsed {
                    let edge_idx = edge_at(
                        &PROTOTYPES[cells[idx].proto_id as usize],
                        dir,
                        cells[idx].rotation as usize,
                    );
                    ADJ_WEIGHTS[edge_idx as usize][edge_ni as usize] > 0
                } else {
                    (0..TOTAL_CANDIDATES).any(|c| {
                        cells[idx].candidates & (1_u64 << c) != 0 && {
                            let (p, r) = decode(c);
                            let e = edge_at(&PROTOTYPES[p], dir, r);
                            ADJ_WEIGHTS[e as usize][edge_ni as usize] > 0
                        }
                    })
                };

                if !supported {
                    cells[ni].candidates &= !(1_u64 << cand_ni);
                    cells[ni].count -= 1;
                    changed = true;
                }
            }

            if changed && !in_queue[ni] {
                queue.push(ni);
                in_queue[ni] = true;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Seed construction
// ---------------------------------------------------------------------------

fn seed_from_halves(seed_hi: u32, seed_lo: u32) -> [u8; 32] {
    let mut seed = [0_u8; 32];
    seed[..4].copy_from_slice(&seed_hi.to_le_bytes());
    seed[4..8].copy_from_slice(&seed_lo.to_le_bytes());
    seed[8..12].copy_from_slice(&seed_hi.rotate_left(7).to_le_bytes());
    seed[12..16].copy_from_slice(&seed_lo.rotate_right(5).to_le_bytes());
    seed[16..20].copy_from_slice(&(seed_hi ^ seed_lo).to_le_bytes());
    seed[20..24].copy_from_slice(&(seed_hi.wrapping_add(seed_lo)).to_le_bytes());
    seed[24..28].copy_from_slice(&(seed_hi.wrapping_mul(31)).to_le_bytes());
    seed[28..32].copy_from_slice(&(seed_lo.wrapping_mul(17)).to_le_bytes());
    seed
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
struct WfcTile {
    q: i32,
    r: i32,
    terrain: u8,
    prototype_id: u8,
    rotation: u8,
    elevation: i8,
    collapse_order: u32,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
struct WfcResult {
    seed_hex: String,
    generator: String,
    radius: u32,
    tile_count: usize,
    void_count: usize,
    terrain_counts: [usize; TERRAIN_COUNT],
    boundary_fix_count: usize,
    tiles: Vec<WfcTile>,
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn engine_version() -> String {
    "mist-wfc-sprint1".to_owned()
}

/// Legacy preview — kept for backwards compatibility.
#[wasm_bindgen]
pub fn generate_preview(seed_hi: u32, seed_lo: u32) -> String {
    generate(seed_hi, seed_lo, 1)
}

/// Generate a hex island using prototype-based integer WFC.
///
/// `radius` controls how many hex rings to generate:
///   0 → 1 tile, 1 → 7 tiles, 2 → 19 tiles, 3 → 37 tiles, etc.
#[wasm_bindgen]
pub fn generate(seed_hi: u32, seed_lo: u32, radius: u32) -> String {
    let coords = hex_spiral(radius as i32);
    let mut rng = ChaCha8Rng::from_seed(seed_from_halves(seed_hi, seed_lo));
    let results = wfc_collapse(&coords, &mut rng);

    let tiles: Vec<WfcTile> = coords
        .iter()
        .zip(results.iter())
        .map(|(&(q, r), &(terrain, proto_id, rotation, collapse_order))| {
            let elevation = if terrain == TERRAIN_VOID {
                0
            } else {
                PROTOTYPES[proto_id as usize].level_delta
            };
            WfcTile {
                q,
                r,
                terrain,
                prototype_id: proto_id,
                rotation,
                elevation,
                collapse_order,
            }
        })
        .collect();

    let mut terrain_counts = [0_usize; TERRAIN_COUNT];
    let mut void_count: usize = 0;
    for &(terrain, _, _, _) in &results {
        if terrain == TERRAIN_VOID {
            void_count += 1;
        } else {
            terrain_counts[terrain as usize] += 1;
        }
    }

    serde_json::to_string(&WfcResult {
        seed_hex: format!("{seed_hi:08x}{seed_lo:08x}"),
        generator: "wasm".to_owned(),
        radius,
        tile_count: tiles.len(),
        void_count,
        terrain_counts,
        boundary_fix_count: 0,
        tiles,
    })
    .expect("WFC result should serialize")
}

/// Generate a hex island with boundary constraints from neighbouring regions.
///
/// `constraints_json` is a JSON array of `{ q, r, dir, edge_type }` objects
/// specifying edge constraints from already-populated neighbours.
#[wasm_bindgen]
pub fn generate_constrained(
    seed_hi: u32,
    seed_lo: u32,
    radius: u32,
    constraints_json: &str,
) -> String {
    let constraints: Vec<BoundaryConstraint> = if constraints_json.is_empty()
        || constraints_json == "[]"
    {
        Vec::new()
    } else {
        serde_json::from_str(constraints_json)
            .expect("invalid boundary constraints JSON")
    };
    let coords = hex_spiral(radius as i32);
    let mut rng = ChaCha8Rng::from_seed(seed_from_halves(seed_hi, seed_lo));
    let (results, boundary_fix_count) =
        wfc_collapse_constrained(&coords, &mut rng, &constraints);

    let tiles: Vec<WfcTile> = coords
        .iter()
        .zip(results.iter())
        .map(|(&(q, r), &(terrain, proto_id, rotation, collapse_order))| {
            let elevation = if terrain == TERRAIN_VOID {
                0
            } else {
                PROTOTYPES[proto_id as usize].level_delta
            };
            WfcTile {
                q,
                r,
                terrain,
                prototype_id: proto_id,
                rotation,
                elevation,
                collapse_order,
            }
        })
        .collect();

    let mut terrain_counts = [0_usize; TERRAIN_COUNT];
    let mut void_count: usize = 0;
    for &(terrain, _, _, _) in &results {
        if terrain == TERRAIN_VOID {
            void_count += 1;
        } else {
            terrain_counts[terrain as usize] += 1;
        }
    }

    serde_json::to_string(&WfcResult {
        seed_hex: format!("{seed_hi:08x}{seed_lo:08x}"),
        generator: "wasm".to_owned(),
        radius,
        tile_count: tiles.len(),
        void_count,
        terrain_counts,
        boundary_fix_count,
        tiles,
    })
    .expect("WFC result should serialize")
}

// ---------------------------------------------------------------------------
// Tests (run with `cargo test`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_output() {
        let a = generate(0xdeadbeef, 0xcafe0001, 1);
        let b = generate(0xdeadbeef, 0xcafe0001, 1);
        assert_eq!(a, b, "same seed must produce identical output");
    }

    #[test]
    fn different_seeds_differ() {
        let a = generate(0xdeadbeef, 0xcafe0001, 1);
        let b = generate(0x00000000, 0x00000001, 1);
        assert_ne!(a, b, "different seeds should produce different output");
    }

    #[test]
    fn radius_zero_single_tile() {
        let result = generate(0x12345678, 0x9abcdef0, 0);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.tile_count, 1);
        assert_eq!(parsed.tiles[0].q, 0);
        assert_eq!(parsed.tiles[0].r, 0);
    }

    #[test]
    fn radius_two_nineteen_tiles() {
        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.tile_count, 19);
    }

    #[test]
    fn prototype_fields_present() {
        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();
        for tile in &parsed.tiles {
            if tile.terrain == TERRAIN_VOID {
                continue;
            }
            assert!(
                (tile.prototype_id as usize) < PROTO_COUNT,
                "prototype_id {} out of range at ({}, {})",
                tile.prototype_id, tile.q, tile.r,
            );
            assert!(
                tile.rotation < 6,
                "rotation {} out of range at ({}, {})",
                tile.rotation, tile.q, tile.r,
            );
            // Verify terrain matches prototype's terrain
            let proto = &PROTOTYPES[tile.prototype_id as usize];
            assert_eq!(
                tile.terrain, proto.terrain,
                "terrain {} != prototype terrain {} at ({}, {})",
                tile.terrain, proto.terrain, tile.q, tile.r,
            );
        }
    }

    #[test]
    fn edge_compatibility_respected() {
        // Adjacent tiles must have compatible touching edges
        let coords = hex_spiral(2);
        let coord_to_idx: BTreeMap<(i32, i32), usize> = coords
            .iter()
            .enumerate()
            .map(|(i, &c)| (c, i))
            .collect();

        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();

        for tile in &parsed.tiles {
            if tile.terrain == TERRAIN_VOID {
                continue;
            }
            for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                let nq = tile.q + dq;
                let nr = tile.r + dr;
                if let Some(&ni) = coord_to_idx.get(&(nq, nr)) {
                    let neighbour = &parsed.tiles[ni];
                    if neighbour.terrain == TERRAIN_VOID {
                        continue;
                    }
                    let opp = (dir + 3) % 6;
                    let edge_a = edge_at(
                        &PROTOTYPES[tile.prototype_id as usize],
                        dir,
                        tile.rotation as usize,
                    );
                    let edge_b = edge_at(
                        &PROTOTYPES[neighbour.prototype_id as usize],
                        opp,
                        neighbour.rotation as usize,
                    );
                    let w = ADJ_WEIGHTS[edge_a as usize][edge_b as usize];
                    assert!(
                        w > 0,
                        "incompatible edges: edge {} (proto {} rot {}) at ({},{}) dir {} -> \
                         edge {} (proto {} rot {}) at ({},{}) dir {}",
                        edge_a, tile.prototype_id, tile.rotation,
                        tile.q, tile.r, dir,
                        edge_b, neighbour.prototype_id, neighbour.rotation,
                        nq, nr, opp,
                    );
                }
            }
        }
    }

    #[test]
    fn terrain_values_in_range() {
        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();
        for tile in &parsed.tiles {
            assert!(
                (tile.terrain as usize) < TERRAIN_COUNT || tile.terrain == TERRAIN_VOID,
                "terrain {} out of range at ({}, {})",
                tile.terrain, tile.q, tile.r,
            );
        }
    }

    #[test]
    fn distribution_no_extreme_bias() {
        let mut totals = [0_usize; TERRAIN_COUNT];
        let mut total_void = 0_usize;
        let runs = 20_u32;

        for i in 0..runs {
            let result = generate(0x10000000 + i, 0x20000000 + i, 3);
            let parsed: WfcResult = serde_json::from_str(&result).unwrap();
            assert_eq!(parsed.void_count, 0, "void found in seed {i}");
            total_void += parsed.void_count;
            for (t, &c) in parsed.terrain_counts.iter().enumerate() {
                totals[t] += c;
                assert!(
                    c <= 25,
                    "terrain {t} has {c}/37 tiles in seed {i} — extreme monopoly",
                );
            }
        }

        assert_eq!(total_void, 0, "void appeared across {runs} seeds");

        for (t, &total) in totals.iter().enumerate() {
            assert!(
                total > 0,
                "terrain {t} never appeared across {runs} seeds",
            );
        }

        let water_total = totals[TERRAIN_SHALLOW as usize] + totals[TERRAIN_DEEP as usize];
        assert!(
            water_total >= 10,
            "water total (shallow {} + deep {}) is too low across {runs} seeds",
            totals[TERRAIN_SHALLOW as usize],
            totals[TERRAIN_DEEP as usize],
        );
    }

    #[test]
    fn empty_constraints_match_unconstrained() {
        let a = generate(0xdeadbeef, 0xcafe0001, 2);
        let b = generate_constrained(0xdeadbeef, 0xcafe0001, 2, "[]");
        let pa: WfcResult = serde_json::from_str(&a).unwrap();
        let pb: WfcResult = serde_json::from_str(&b).unwrap();
        assert_eq!(pa.tile_count, pb.tile_count);
        assert_eq!(pa.boundary_fix_count, 0);
        assert_eq!(pb.boundary_fix_count, 0);
        for (ta, tb) in pa.tiles.iter().zip(pb.tiles.iter()) {
            assert_eq!(ta.terrain, tb.terrain);
            assert_eq!(ta.prototype_id, tb.prototype_id);
            assert_eq!(ta.rotation, tb.rotation);
        }
    }

    #[test]
    fn seam_constraints_respected() {
        // Generate region A at (0,0). Extract boundary edges.
        // Generate region B at (1,0) with those constraints.
        // Verify touching edges are compatible.
        let radius: i32 = 2;
        let spacing = 2 * radius + 1;

        let result_a = generate(0xAAAA0000, 0xBBBB0000, radius as u32);
        let ra: WfcResult = serde_json::from_str(&result_a).unwrap();

        // Build tile lookup for region A
        // Build constraints: for each tile in region A, check if its neighbour
        // in any direction would land in region B's local space.
        let b_coords: std::collections::HashSet<(i32, i32)> =
            hex_spiral(radius).into_iter().collect();

        let mut constraints = Vec::new();
        let a_origin_q = 0_i32;
        let a_origin_r = 0_i32;
        let b_macro_q = 1_i32;
        let b_macro_r = 0_i32;
        let b_origin_q = b_macro_q * spacing;
        let b_origin_r = b_macro_r * spacing;

        for tile in &ra.tiles {
            if tile.terrain == TERRAIN_VOID { continue; }
            let world_q = a_origin_q + tile.q;
            let world_r = a_origin_r + tile.r;
            for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                let adj_wq = world_q + dq;
                let adj_wr = world_r + dr;
                let local_q = adj_wq - b_origin_q;
                let local_r = adj_wr - b_origin_r;
                if b_coords.contains(&(local_q, local_r)) {
                    let existing_edge = edge_at(
                        &PROTOTYPES[tile.prototype_id as usize],
                        dir,
                        tile.rotation as usize,
                    );
                    constraints.push(BoundaryConstraint {
                        q: local_q,
                        r: local_r,
                        dir: (dir + 3) % 6,
                        edge_type: existing_edge,
                    });
                }
            }
        }

        assert!(!constraints.is_empty(), "should have boundary constraints");

        let cj = serde_json::to_string(&constraints).unwrap();
        let result_b = generate_constrained(0xCCCC0000, 0xDDDD0000, radius as u32, &cj);
        let rb: WfcResult = serde_json::from_str(&result_b).unwrap();

        // Verify seam: touching edges must be compatible
        let b_tiles: BTreeMap<(i32, i32), &WfcTile> = rb.tiles.iter()
            .map(|t| ((t.q, t.r), t))
            .collect();

        for tile_a in &ra.tiles {
            if tile_a.terrain == TERRAIN_VOID { continue; }
            let wq = a_origin_q + tile_a.q;
            let wr = a_origin_r + tile_a.r;
            for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                let adj_wq = wq + dq;
                let adj_wr = wr + dr;
                let lq = adj_wq - b_origin_q;
                let lr = adj_wr - b_origin_r;
                if let Some(tile_b) = b_tiles.get(&(lq, lr)) {
                    if tile_b.terrain == TERRAIN_VOID { continue; }
                    let opp = (dir + 3) % 6;
                    let edge_a = edge_at(
                        &PROTOTYPES[tile_a.prototype_id as usize],
                        dir,
                        tile_a.rotation as usize,
                    );
                    let edge_b = edge_at(
                        &PROTOTYPES[tile_b.prototype_id as usize],
                        opp,
                        tile_b.rotation as usize,
                    );
                    let w = ADJ_WEIGHTS[edge_a as usize][edge_b as usize];
                    assert!(
                        w > 0,
                        "seam incompatible: A({},{}) edge {} dir {} -> B({},{}) edge {} dir {}",
                        tile_a.q, tile_a.r, edge_a, dir,
                        tile_b.q, tile_b.r, edge_b, opp,
                    );
                }
            }
        }
    }

    #[test]
    fn seam_constraints_multi_direction() {
        // Test seam constraints across multiple macro directions and seeds.
        // With radius=3 and more seeds, we get more boundary tiles and higher
        // chance of filtering (e.g. deep water boundaries).
        let radius: i32 = 3;
        let spacing = 2 * radius + 1;

        let b_coords: std::collections::HashSet<(i32, i32)> =
            hex_spiral(radius).into_iter().collect();

        for seed_i in 0..10_u32 {
            for &(macro_dq, macro_dr) in &[(1_i32, 0_i32), (0, 1), (1, -1)] {
                let result_a = generate(0x50000000 + seed_i, 0x60000000 + seed_i, radius as u32);
                let ra: WfcResult = serde_json::from_str(&result_a).unwrap();

                let b_origin_q = macro_dq * spacing;
                let b_origin_r = macro_dr * spacing;

                let mut constraints = Vec::new();
                for tile in &ra.tiles {
                    if tile.terrain == TERRAIN_VOID { continue; }
                    for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                        let adj_wq = tile.q + dq;
                        let adj_wr = tile.r + dr;
                        let local_q = adj_wq - b_origin_q;
                        let local_r = adj_wr - b_origin_r;
                        if b_coords.contains(&(local_q, local_r)) {
                            let existing_edge = edge_at(
                                &PROTOTYPES[tile.prototype_id as usize],
                                dir,
                                tile.rotation as usize,
                            );
                            constraints.push(BoundaryConstraint {
                                q: local_q,
                                r: local_r,
                                dir: (dir + 3) % 6,
                                edge_type: existing_edge,
                            });
                        }
                    }
                }

                if constraints.is_empty() { continue; }

                let cj = serde_json::to_string(&constraints).unwrap();
                let result_b = generate_constrained(
                    0x70000000 + seed_i, 0x80000000 + seed_i, radius as u32, &cj,
                );
                let rb: WfcResult = serde_json::from_str(&result_b).unwrap();

                // Verify seam compatibility
                let b_tiles: BTreeMap<(i32, i32), &WfcTile> = rb.tiles.iter()
                    .map(|t| ((t.q, t.r), t))
                    .collect();

                for tile_a in &ra.tiles {
                    if tile_a.terrain == TERRAIN_VOID { continue; }
                    for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                        let lq = tile_a.q + dq - b_origin_q;
                        let lr = tile_a.r + dr - b_origin_r;
                        if let Some(tile_b) = b_tiles.get(&(lq, lr)) {
                            if tile_b.terrain == TERRAIN_VOID { continue; }
                            let opp = (dir + 3) % 6;
                            let edge_a = edge_at(
                                &PROTOTYPES[tile_a.prototype_id as usize],
                                dir,
                                tile_a.rotation as usize,
                            );
                            let edge_b = edge_at(
                                &PROTOTYPES[tile_b.prototype_id as usize],
                                opp,
                                tile_b.rotation as usize,
                            );
                            let w = ADJ_WEIGHTS[edge_a as usize][edge_b as usize];
                            assert!(
                                w > 0,
                                "seam fail seed={seed_i} dir=({macro_dq},{macro_dr}): \
                                 A({},{}) e{edge_a} d{dir} -> B({},{}) e{edge_b} d{opp}",
                                tile_a.q, tile_a.r, tile_b.q, tile_b.r,
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn deep_water_edges_only_touch_water_edges() {
        // Deep water edges must only touch shallow or deep edges.
        // With prototype rotations, a tile may have terrain=sand but
        // a shallow-water edge facing deep water (e.g. COAST_STRAIGHT).
        // The constraint is at the edge level, not the terrain level.
        let coords = hex_spiral(3);
        let coord_to_idx: BTreeMap<(i32, i32), usize> = coords
            .iter()
            .enumerate()
            .map(|(i, &c)| (c, i))
            .collect();

        for i in 0..50_u32 {
            let result = generate(0x30000000 + i, 0x40000000 + i, 3);
            let parsed: WfcResult = serde_json::from_str(&result).unwrap();

            for tile in &parsed.tiles {
                if tile.terrain == TERRAIN_VOID {
                    continue;
                }
                for (dir, &(dq, dr)) in HEX_DIRS.iter().enumerate() {
                    let nq = tile.q + dq;
                    let nr = tile.r + dr;
                    if let Some(&ni) = coord_to_idx.get(&(nq, nr)) {
                        let neighbour = &parsed.tiles[ni];
                        if neighbour.terrain == TERRAIN_VOID {
                            continue;
                        }
                        let opp = (dir + 3) % 6;
                        let edge_a = edge_at(
                            &PROTOTYPES[tile.prototype_id as usize],
                            dir,
                            tile.rotation as usize,
                        );
                        if edge_a != TERRAIN_DEEP {
                            continue;
                        }
                        let edge_b = edge_at(
                            &PROTOTYPES[neighbour.prototype_id as usize],
                            opp,
                            neighbour.rotation as usize,
                        );
                        assert!(
                            edge_b == TERRAIN_SHALLOW || edge_b == TERRAIN_DEEP,
                            "deep edge at ({},{}) dir {} touches non-water edge {} at ({},{}) in seed {i}",
                            tile.q, tile.r, dir,
                            edge_b, nq, nr,
                        );
                    }
                }
            }
        }
    }
}
