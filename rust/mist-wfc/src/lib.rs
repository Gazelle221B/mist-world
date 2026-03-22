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
use serde::Serialize;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Hex coordinate helpers (axial)
// ---------------------------------------------------------------------------

/// Six axial direction offsets: NE, E, SE, SW, W, NW
const HEX_DIRS: [(i32, i32); 6] = [
    (1, -1),  // NE
    (1, 0),   // E
    (0, 1),   // SE
    (-1, 1),  // SW
    (-1, 0),  // W
    (0, -1),  // NW
];

/// Generate all axial coordinates for a hex ring of given radius.
fn hex_ring(radius: i32) -> Vec<(i32, i32)> {
    if radius == 0 {
        return vec![(0, 0)];
    }
    let mut coords = Vec::with_capacity(6 * radius as usize);
    let mut q = radius;
    let mut r = -radius;
    // Walk each of 6 edges
    for dir_idx in 0..6 {
        let (dq, dr) = HEX_DIRS[(dir_idx + 2) % 6]; // walk direction
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
// Adjacency rules (integer-only)
// ---------------------------------------------------------------------------

/// Number of terrain types.
const TERRAIN_COUNT: usize = 4;

/// Adjacency weight table: `ADJ_WEIGHTS[from][to]` is the integer weight
/// for terrain `to` appearing next to terrain `from`. Zero means forbidden.
///
/// grass(0) — prefers grass, sand; avoids water
/// sand(1)  — bridges grass and water
/// rock(2)  — prefers rock, grass; avoids water
/// water(3) — prefers water, sand; avoids grass, rock
const ADJ_WEIGHTS: [[u32; TERRAIN_COUNT]; TERRAIN_COUNT] = [
    // to:  grass  sand  rock  water
    [  10,    6,    4,    0 ],  // from grass
    [   6,    8,    3,    5 ],  // from sand
    [   4,    3,   10,    0 ],  // from rock
    [   0,    5,    0,   10 ],  // from water
];

// ---------------------------------------------------------------------------
// WFC core (integer entropy)
// ---------------------------------------------------------------------------

/// Per-cell state during WFC collapse.
#[derive(Clone)]
struct Cell {
    /// Remaining candidates as a bitmask (bit i = terrain i is possible).
    candidates: u32,
    /// Number of remaining candidates (integer entropy).
    count: u32,
    /// Whether this cell has been collapsed.
    collapsed: bool,
    /// Assigned terrain (valid only when collapsed).
    terrain: u8,
}

impl Cell {
    fn new() -> Self {
        Self {
            candidates: (1 << TERRAIN_COUNT) - 1, // all bits set
            count: TERRAIN_COUNT as u32,
            collapsed: false,
            terrain: 0,
        }
    }
}

/// Run WFC on a hex grid of given radius.
/// Returns terrain assignments indexed by coord order from hex_spiral.
fn wfc_collapse(coords: &[(i32, i32)], rng: &mut ChaCha8Rng) -> Vec<u8> {
    let n = coords.len();

    // Map (q, r) -> index for neighbour lookup
    let coord_to_idx: BTreeMap<(i32, i32), usize> = coords
        .iter()
        .enumerate()
        .map(|(i, &c)| (c, i))
        .collect();

    // Precompute adjacency lists (indices of neighbours)
    let neighbours: Vec<Vec<usize>> = coords
        .iter()
        .map(|&(q, r)| {
            HEX_DIRS
                .iter()
                .filter_map(|&(dq, dr)| coord_to_idx.get(&(q + dq, r + dr)).copied())
                .collect()
        })
        .collect();

    let mut cells: Vec<Cell> = vec![Cell::new(); n];
    let mut collapsed_count: usize = 0;

    while collapsed_count < n {
        // 1. Find uncollapsed cell with minimum entropy (candidate count).
        //    Break ties with RNG for determinism that doesn't depend on
        //    iteration order beyond BTreeMap guarantees.
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
            break; // all collapsed
        }

        // Deterministic tie-break: pick using RNG
        let pick_idx = (rng.next_u32() as usize) % min_candidates.len();
        let cell_idx = min_candidates[pick_idx];

        // 2. Contradiction check: if no candidates remain, assign VOID (0).
        if cells[cell_idx].count == 0 {
            cells[cell_idx].collapsed = true;
            cells[cell_idx].terrain = 0; // VOID fallback
            collapsed_count += 1;
            continue;
        }

        // 3. Collapse: pick a terrain weighted by adjacency context.
        let terrain = pick_terrain(&cells[cell_idx], &neighbours[cell_idx], &cells, rng);
        cells[cell_idx].collapsed = true;
        cells[cell_idx].terrain = terrain;
        cells[cell_idx].candidates = 1 << terrain;
        cells[cell_idx].count = 1;
        collapsed_count += 1;

        // 4. Propagate constraints to neighbours.
        propagate(cell_idx, &neighbours, &mut cells);
    }

    cells.iter().map(|c| c.terrain).collect()
}

/// Pick a terrain from the cell's candidates, weighted by neighbour context.
fn pick_terrain(
    cell: &Cell,
    neighbour_indices: &[usize],
    all_cells: &[Cell],
    rng: &mut ChaCha8Rng,
) -> u8 {
    let mut weights = [0_u32; TERRAIN_COUNT];

    for t in 0..TERRAIN_COUNT {
        if cell.candidates & (1 << t) == 0 {
            continue; // not a candidate
        }

        // Base weight = 1 (so unconstrained cells still have weight)
        let mut w: u32 = 1;

        for &ni in neighbour_indices {
            let ncell = &all_cells[ni];
            if ncell.collapsed {
                // Use adjacency weight from the collapsed neighbour
                w = w.saturating_add(ADJ_WEIGHTS[ncell.terrain as usize][t]);
            } else {
                // Sum adjacency weights over remaining candidates
                for nt in 0..TERRAIN_COUNT {
                    if ncell.candidates & (1 << nt) != 0 {
                        w = w.saturating_add(ADJ_WEIGHTS[nt][t]);
                    }
                }
            }
        }

        weights[t] = w;
    }

    // Weighted random selection (integer only)
    let total: u32 = weights.iter().sum();
    if total == 0 {
        return 0; // contradiction fallback
    }

    let mut roll = rng.next_u32() % total;
    for (t, &w) in weights.iter().enumerate() {
        if roll < w {
            return t as u8;
        }
        roll -= w;
    }

    0 // shouldn't reach here
}

/// Propagate constraints from a just-collapsed cell outward.
fn propagate(start: usize, neighbours: &[Vec<usize>], cells: &mut [Cell]) {
    let mut stack = vec![start];

    while let Some(idx) = stack.pop() {
        let collapsed_terrain = cells[idx].terrain;

        for &ni in &neighbours[idx] {
            if cells[ni].collapsed {
                continue;
            }

            let mut changed = false;
            for t in 0..TERRAIN_COUNT {
                if cells[ni].candidates & (1 << t) == 0 {
                    continue; // already removed
                }
                // Remove candidate if adjacency weight is 0
                // (i.e., this terrain is forbidden next to the collapsed one)
                if ADJ_WEIGHTS[collapsed_terrain as usize][t] == 0 {
                    cells[ni].candidates &= !(1 << t);
                    cells[ni].count -= 1;
                    changed = true;
                }
            }

            if changed {
                stack.push(ni);
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
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
struct WfcResult {
    seed_hex: String,
    generator: String,
    radius: u32,
    tile_count: usize,
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

/// Generate a hex island using integer WFC.
///
/// `radius` controls how many hex rings to generate:
///   0 → 1 tile, 1 → 7 tiles, 2 → 19 tiles, 3 → 37 tiles, etc.
#[wasm_bindgen]
pub fn generate(seed_hi: u32, seed_lo: u32, radius: u32) -> String {
    let coords = hex_spiral(radius as i32);
    let mut rng = ChaCha8Rng::from_seed(seed_from_halves(seed_hi, seed_lo));
    let terrains = wfc_collapse(&coords, &mut rng);

    let tiles: Vec<WfcTile> = coords
        .iter()
        .zip(terrains.iter())
        .map(|(&(q, r), &terrain)| WfcTile { q, r, terrain })
        .collect();

    serde_json::to_string(&WfcResult {
        seed_hex: format!("{seed_hi:08x}{seed_lo:08x}"),
        generator: "wasm".to_owned(),
        radius,
        tile_count: tiles.len(),
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
    fn adjacency_constraints_respected() {
        // Generate a larger island and verify no forbidden adjacencies
        let coords = hex_spiral(2);
        let coord_to_idx: BTreeMap<(i32, i32), usize> = coords
            .iter()
            .enumerate()
            .map(|(i, &c)| (c, i))
            .collect();

        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();

        for tile in &parsed.tiles {
            for &(dq, dr) in &HEX_DIRS {
                let nq = tile.q + dq;
                let nr = tile.r + dr;
                if let Some(&ni) = coord_to_idx.get(&(nq, nr)) {
                    let neighbour = &parsed.tiles[ni];
                    let w = ADJ_WEIGHTS[tile.terrain as usize][neighbour.terrain as usize];
                    assert!(
                        w > 0,
                        "forbidden adjacency: terrain {} next to {} at ({},{}) -> ({},{})",
                        tile.terrain, neighbour.terrain,
                        tile.q, tile.r, nq, nr
                    );
                }
            }
        }
    }

    #[test]
    fn no_floating_point_in_output() {
        // Ensure output is valid JSON with only integer terrain values
        let result = generate(0xdeadbeef, 0xcafe0001, 2);
        let parsed: WfcResult = serde_json::from_str(&result).unwrap();
        for tile in &parsed.tiles {
            assert!(tile.terrain < TERRAIN_COUNT as u8);
        }
    }
}
