use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[wasm_bindgen]
pub fn crypto_backend_name() -> String {
    "mist-crypto-sprint0".to_owned()
}

#[wasm_bindgen]
pub fn derive_peer_id_hex(public_key: Vec<u8>) -> String {
    let digest = Sha256::digest(public_key);
    to_hex(&digest[..8])
}
