/**
 * Seed parsing from URL hash.
 *
 * Accepts `#deadbeefcafe0001` (16 hex digits = 8-byte seed).
 * Invalid or missing hash falls back to the default seed.
 */

const DEFAULT_SEED_HI = 0xdeadbeef;
const DEFAULT_SEED_LO = 0xcafe0001;

export interface SeedPair {
  hi: number;
  lo: number;
}

const HEX16_RE = /^#?([0-9a-f]{16})$/i;

/**
 * Parse a 16-hex-digit seed string into hi/lo u32 pair.
 * Returns `null` if the input is not exactly 16 hex digits (optional leading `#`).
 */
export function parseSeedHex(raw: string): SeedPair | null {
  const match = HEX16_RE.exec(raw);
  if (!match) return null;
  const hex = match[1];
  const hi = parseInt(hex.slice(0, 8), 16) >>> 0;
  const lo = parseInt(hex.slice(8, 16), 16) >>> 0;
  return { hi, lo };
}

/**
 * Read the seed from `location.hash`.
 * Falls back to the default seed if the hash is missing or malformed.
 */
export function seedFromHash(): SeedPair {
  if (typeof location === "undefined") return { hi: DEFAULT_SEED_HI, lo: DEFAULT_SEED_LO };
  const parsed = parseSeedHex(location.hash);
  return parsed ?? { hi: DEFAULT_SEED_HI, lo: DEFAULT_SEED_LO };
}
