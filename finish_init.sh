#!/bin/bash
set -e

shopt -s dotglob
cp -r __temp_vite/tmp-app/* ./
shopt -u dotglob
rm -rf __temp_vite

echo "Initializing Rust workspaces..."
mkdir -p rust
cat << 'EOF' > rust/Cargo.toml
[workspace]
members = [
    "mist-wfc",
    "mist-crypto"
]
resolver = "2"
EOF

cd rust
cargo new mist-wfc --lib || true
cargo new mist-crypto --lib || true

cat << 'EOF' > mist-wfc/Cargo.toml
[package]
name = "mist-wfc"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
rand_chacha = "0.3"
rand_core = "0.6"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
EOF

cat << 'EOF' > mist-crypto/Cargo.toml
[package]
name = "mist-crypto"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
EOF

cd ..
rm -f init_project.sh finish_init.sh
echo "Project Initialization Complete"
