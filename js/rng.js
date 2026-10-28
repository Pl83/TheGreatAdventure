// Swappable random source so the engine can be seeded for simulations and tests
let source = Math.random;

export const random = () => source();
export const setRandom = fn => { source = fn; };

// Runs thunk with fn as the source, restoring the previous one even if it throws
export function withRandom(fn, thunk) {
  const prev = source;
  source = fn;
  try { return thunk(); } finally { source = prev; }
}

// Small seeded PRNG: same seed, same sequence
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
