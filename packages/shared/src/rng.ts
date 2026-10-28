/**
 * Seedable randomness. Gameplay code never calls Math.random: it takes an Rng as
 * a parameter, so the server can seed it per fight and replay any fight exactly.
 */

/** Returns uniform numbers in [0, 1). */
export type Rng = () => number;

/** Mulberry32: tiny, fast, and the same sequence for the same seed on every platform. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A shuffled copy (Fisher-Yates); the input is left untouched. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
