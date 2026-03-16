use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::Serialize;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct PreviewTile {
    q: i32,
    r: i32,
    terrain: u8,
}

#[derive(Serialize)]
struct PreviewWorld {
    seed_hex: String,
    dominant_terrain: u8,
    tiles: Vec<PreviewTile>,
}

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

#[wasm_bindgen]
pub fn engine_version() -> String {
    "mist-wfc-sprint0".to_owned()
}

#[wasm_bindgen]
pub fn generate_preview(seed_hi: u32, seed_lo: u32) -> String {
    let coords = [(0, 0), (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];
    let mut terrain_counts = BTreeMap::<u8, usize>::new();
    let mut rng = ChaCha8Rng::from_seed(seed_from_halves(seed_hi, seed_lo));

    let mut tiles = Vec::with_capacity(coords.len());
    for (q, r) in coords {
        let terrain = (rng.next_u32() % 4) as u8;
        *terrain_counts.entry(terrain).or_default() += 1;
        tiles.push(PreviewTile { q, r, terrain });
    }

    let dominant_terrain = terrain_counts
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(terrain, _)| *terrain)
        .unwrap_or(0);

    serde_json::to_string(&PreviewWorld {
        seed_hex: format!("{seed_hi:08x}{seed_lo:08x}"),
        dominant_terrain,
        tiles,
    })
    .expect("preview world should serialize")
}
