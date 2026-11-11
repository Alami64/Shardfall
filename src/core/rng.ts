// Seeded random numbers (mulberry32). Gameplay never calls Math.random directly.
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole number from a to b, both included. */
export const rint = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
