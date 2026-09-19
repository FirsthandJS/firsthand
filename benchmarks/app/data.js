/**
 * Deterministic dataset, shared by every implementation.
 *
 * A seeded PRNG rather than Math.random, so both frameworks receive exactly the
 * same rows in the same order in the same run (PERFORMANCE_PLAN section 1).
 */
const ADJECTIVES = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
];
const COLOURS = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'white',
  'black',
  'orange',
];
const NOUNS = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

/** xorshift32: tiny, deterministic, and good enough to pick labels. */
export function createRandom(seed = 0x1a2b3c4d) {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function createDataFactory(seed) {
  const random = createRandom(seed);
  let nextId = 1;
  const pick = (list) => list[Math.floor(random() * list.length)];
  return (count) => {
    const rows = new Array(count);
    for (let i = 0; i < count; i++) {
      rows[i] = {
        id: nextId++,
        label: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`,
      };
    }
    return rows;
  };
}
