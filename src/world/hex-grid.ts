const SQRT3 = Math.sqrt(3);

export function axialToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: 1.5 * q,
    z: (SQRT3 / 2) * q + SQRT3 * r,
  };
}
