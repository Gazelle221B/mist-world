#!/bin/bash
set -e

rm -rf __temp_vite
echo "Initializing Vite project in a temporary directory..."
mkdir -p __temp_vite
cd __temp_vite
npx --cache /tmp/mist_npm_cache -y create-vite@latest tmp-app --template vanilla-ts
cd tmp-app
echo "Installing dependencies..."
npm --cache /tmp/mist_npm_cache install @babylonjs/core @babylonjs/havok loro-crdt @msgpack/msgpack 
npm --cache /tmp/mist_npm_cache install -D vite typescript
cd ../..
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
rm init_project.sh
echo "Initialization Complete!"
