/**
 * Generate a placeholder rock.glb — hex-cylinder mesh matching the
 * primitive geometry used in the renderer (tessellation=6, diameter=1.73,
 * height=1). Run with: npx tsx scripts/gen-rock-glb.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";

const RADIUS = 1.73 / 2;
const HALF_H = 0.5;

// Build hex cylinder geometry: 14 vertices (7 top + 7 bottom), flat-shaded
// Top center, top ring, bottom center, bottom ring

function hexVertices(): { positions: number[]; normals: number[]; indices: number[] } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // --- Top face (Y = +HALF_H) ---
  // center vertex
  const topCenter = 0;
  positions.push(0, HALF_H, 0);
  normals.push(0, 1, 0);

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    positions.push(Math.cos(angle) * RADIUS, HALF_H, Math.sin(angle) * RADIUS);
    normals.push(0, 1, 0);
  }
  // top fan triangles
  for (let i = 0; i < 6; i++) {
    indices.push(topCenter, topCenter + 1 + i, topCenter + 1 + ((i + 1) % 6));
  }

  // --- Bottom face (Y = -HALF_H) ---
  const botCenter = 7;
  positions.push(0, -HALF_H, 0);
  normals.push(0, -1, 0);

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    positions.push(Math.cos(angle) * RADIUS, -HALF_H, Math.sin(angle) * RADIUS);
    normals.push(0, -1, 0);
  }
  // bottom fan triangles (reversed winding)
  for (let i = 0; i < 6; i++) {
    indices.push(botCenter, botCenter + 1 + ((i + 1) % 6), botCenter + 1 + i);
  }

  // --- Side faces ---
  // Each side quad needs its own vertices for correct normals
  const sideStart = 14;
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI / 3) * i;
    const a1 = (Math.PI / 3) * ((i + 1) % 6);
    const midAngle = (a0 + a1) / 2;
    const nx = Math.cos(midAngle);
    const nz = Math.sin(midAngle);

    const x0 = Math.cos(a0) * RADIUS;
    const z0 = Math.sin(a0) * RADIUS;
    const x1 = Math.cos(a1) * RADIUS;
    const z1 = Math.sin(a1) * RADIUS;

    const base = sideStart + i * 4;
    // top-left, top-right, bottom-right, bottom-left
    positions.push(x0, HALF_H, z0);
    normals.push(nx, 0, nz);
    positions.push(x1, HALF_H, z1);
    normals.push(nx, 0, nz);
    positions.push(x1, -HALF_H, z1);
    normals.push(nx, 0, nz);
    positions.push(x0, -HALF_H, z0);
    normals.push(nx, 0, nz);

    indices.push(base, base + 1, base + 2);
    indices.push(base, base + 2, base + 3);
  }

  return { positions, normals, indices };
}

function buildGlb(): Buffer {
  const { positions, normals, indices } = hexVertices();

  // Binary buffer: positions (float32) + normals (float32) + indices (uint16)
  const posData = new Float32Array(positions);
  const normData = new Float32Array(normals);
  const idxData = new Uint16Array(indices);

  const posByteLen = posData.byteLength;
  const normByteLen = normData.byteLength;
  const idxByteLen = idxData.byteLength;
  // Pad index buffer to 4-byte alignment
  const idxPadded = idxByteLen % 4 === 0 ? idxByteLen : idxByteLen + (4 - (idxByteLen % 4));
  const totalBinLen = posByteLen + normByteLen + idxPadded;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  const vertexCount = positions.length / 3;

  const gltfJson = {
    asset: { version: "2.0", generator: "gen-rock-glb" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "rock" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5123, // UNSIGNED_SHORT
        count: indices.length,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posByteLen, target: 34962 },
      { buffer: 0, byteOffset: posByteLen, byteLength: normByteLen, target: 34962 },
      { buffer: 0, byteOffset: posByteLen + normByteLen, byteLength: idxByteLen, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinLen }],
  };

  const jsonStr = JSON.stringify(gltfJson);
  // Pad JSON to 4-byte alignment
  const jsonPadded = jsonStr + " ".repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonBuf = Buffer.from(jsonPadded, "utf-8");

  const binBuf = Buffer.alloc(totalBinLen);
  Buffer.from(posData.buffer).copy(binBuf, 0);
  Buffer.from(normData.buffer).copy(binBuf, posByteLen);
  Buffer.from(idxData.buffer).copy(binBuf, posByteLen + normByteLen);

  // GLB header: magic + version + length
  const headerLen = 12;
  const jsonChunkLen = 8 + jsonBuf.length; // chunk header + data
  const binChunkLen = 8 + binBuf.length;
  const totalLen = headerLen + jsonChunkLen + binChunkLen;

  const glb = Buffer.alloc(totalLen);
  let offset = 0;

  // GLB header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // magic "glTF"
  glb.writeUInt32LE(2, offset); offset += 4;           // version
  glb.writeUInt32LE(totalLen, offset); offset += 4;    // total length

  // JSON chunk
  glb.writeUInt32LE(jsonBuf.length, offset); offset += 4;  // chunk length
  glb.writeUInt32LE(0x4E4F534A, offset); offset += 4;      // chunk type "JSON"
  jsonBuf.copy(glb, offset); offset += jsonBuf.length;

  // BIN chunk
  glb.writeUInt32LE(binBuf.length, offset); offset += 4;   // chunk length
  glb.writeUInt32LE(0x004E4942, offset); offset += 4;      // chunk type "BIN\0"
  binBuf.copy(glb, offset);

  return glb;
}

const outDir = "public/assets/terrain";
mkdirSync(outDir, { recursive: true });
const glb = buildGlb();
writeFileSync(`${outDir}/rock.glb`, glb);
console.log(`Wrote ${outDir}/rock.glb (${glb.length} bytes)`);
