/**
 * Page-side harness for the reconciler comparison (ADR-0010).
 *
 * Every candidate is handed the same starting DOM and the same target order,
 * and each run is verified: after the reconcile, the parent's children must be
 * exactly the target list, in order. An algorithm that is fast and wrong is not
 * a candidate.
 */
import { naive, prefixSuffix, shipped } from './candidates.js';

const CANDIDATES = { shipped, prefixSuffix, naive };

const container = document.createElement('div');
document.body.appendChild(container);

function build(count) {
  const nodes = new Array(count);
  for (let i = 0; i < count; i++) {
    const node = document.createElement('i');
    node.textContent = String(i);
    nodes[i] = node;
  }
  return nodes;
}

/** Deterministic shuffle of a fraction of the list, seeded per call. */
function shuffle(nodes, fraction, seed) {
  const next = nodes.slice();
  let state = seed;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const swaps = Math.floor(next.length * fraction);
  for (let i = 0; i < swaps; i++) {
    const x = Math.floor(random() * next.length);
    const y = Math.floor(random() * next.length);
    const held = next[x];
    next[x] = next[y];
    next[y] = held;
  }
  return next;
}

const OPERATIONS = {
  append: (nodes) => nodes.concat(build(Math.max(1, Math.floor(nodes.length / 10)))),
  prepend: (nodes) => build(Math.max(1, Math.floor(nodes.length / 10))).concat(nodes),
  insertMiddle: (nodes) => {
    const half = nodes.length >> 1;
    return nodes.slice(0, half).concat(build(100), nodes.slice(half));
  },
  removeMiddle: (nodes) => nodes.filter((_, i) => i % 10 !== 0),
  swapEnds: (nodes) => {
    const next = nodes.slice();
    const first = next[1];
    next[1] = next[next.length - 2];
    next[next.length - 2] = first;
    return next;
  },
  reverse: (nodes) => nodes.slice().reverse(),
  shuffle10: (nodes) => shuffle(nodes, 0.1, 0x2f6e2b1),
  shuffleAll: (nodes) => shuffle(nodes, 1, 0x5bd1e995),
  replaceAll: (nodes) => build(nodes.length),
  clear: () => [],
};

globalThis.reconcilerHarness = {
  operations: Object.keys(OPERATIONS),

  /**
   * Times one operation for one candidate.
   *
   * Setup is not timed: the starting list is mounted, then the clock runs over
   * the reconcile plus the forced layout it causes.
   */
  measure(candidate, operation, size) {
    const initial = build(size);
    container.textContent = '';
    for (let i = 0; i < initial.length; i++) {
      container.appendChild(initial[i]);
    }
    void document.body.offsetHeight;

    const target = OPERATIONS[operation](initial);
    const reconcile = CANDIDATES[candidate];

    const start = performance.now();
    reconcile(container, null, initial, target);
    void document.body.offsetHeight;
    const elapsed = performance.now() - start;

    // Correctness is part of the measurement, not a separate concern.
    const actual = [...container.childNodes];
    let correct = actual.length === target.length;
    for (let i = 0; correct && i < target.length; i++) {
      correct = actual[i] === target[i];
    }
    container.textContent = '';
    return { elapsed, correct };
  },

  /** Counts the DOM mutations a candidate performs, by instrumenting the parent. */
  countMutations(candidate, operation, size) {
    const initial = build(size);
    container.textContent = '';
    for (let i = 0; i < initial.length; i++) {
      container.appendChild(initial[i]);
    }
    const target = OPERATIONS[operation](initial);

    let inserts = 0;
    let removals = 0;
    const realInsert = container.insertBefore.bind(container);
    const realRemove = container.removeChild.bind(container);
    container.insertBefore = (node, anchor) => {
      inserts++;
      return realInsert(node, anchor);
    };
    container.removeChild = (node) => {
      removals++;
      return realRemove(node);
    };
    CANDIDATES[candidate](container, null, initial, target);
    delete container.insertBefore;
    delete container.removeChild;
    container.textContent = '';
    return { inserts, removals };
  },
};
