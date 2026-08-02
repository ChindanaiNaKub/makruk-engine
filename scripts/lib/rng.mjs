// Seeded PRNG shared by match-arena (opening selection) and preflight (which
// asserts it is pure — a PRNG that quietly reached for Date.now()/Math.random()
// would make `--seed S` stop reproducing a block without anything looking wrong).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The opening index -> seed mapping, so preflight tests what the arena actually uses.
export const openingSeed = (seed, openingIdx) => seed * 7919 + openingIdx;
