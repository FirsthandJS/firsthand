/**
 * Two node lists, made the same in the fewest moves (ADR-0010).
 *
 * Its own module because it is its own algorithm and its own decision: which
 * reconciler this is was settled by measurement, the comparison is published
 * in `benchmarks/results/reconcilers.json`, and changing it means running that
 * comparison again rather than reading the code around it.
 */

/**
 * Reconciles two node lists in place, by node identity.
 *
 * Keyed lists reuse their rows' DOM nodes across reorders, so identity is
 * exactly the right key here: a row that survived is the same node, and only
 * nodes that genuinely moved are touched.
 *
 * The algorithm is a common-prefix/suffix trim, then a longest-increasing-
 * subsequence over the surviving nodes, moving only the ones outside it — the
 * provably minimal number of `insertBefore` calls.
 *
 * This is the outcome of the comparison ADR-0010 required, not an assumption:
 * three candidates were measured over ten operations at two sizes, with the
 * order rotated per repetition and correctness asserted on every run. LIS came
 * out ahead overall (1.02 against 1.17 for the two-ended scan and 1.49 for the
 * naive baseline) and decisively where moves are few and far apart — a swap at
 * 10 000 rows costs it 2 moves instead of 9 997. It loses one case: a full
 * reverse, where the subsequence is length 1 and the analysis buys nothing.
 * That trade is published in `benchmarks/results/reconcilers.json`.
 */
export function reconcile(parent: Node, marker: Node | null, a: Node[], b: Node[]): void {
  let aStart = 0;
  let bStart = 0;
  let aEnd = a.length - 1;
  let bEnd = b.length - 1;

  while (aStart <= aEnd && bStart <= bEnd && a[aStart] === b[bStart]) {
    aStart++;
    bStart++;
  }
  while (aStart <= aEnd && bStart <= bEnd && a[aEnd] === b[bEnd]) {
    aEnd--;
    bEnd--;
  }

  const after = bEnd + 1 < b.length ? (b[bEnd + 1] as Node) : marker;

  if (aStart > aEnd) {
    // Pure insertion.
    for (let i = bStart; i <= bEnd; i++) {
      parent.insertBefore(b[i] as Node, after);
    }
    return;
  }
  if (bStart > bEnd) {
    // Pure removal.
    for (let i = aStart; i <= aEnd; i++) {
      parent.removeChild(a[i] as Node);
    }
    return;
  }

  reorder(parent, b, after, { a, aStart, aEnd, bStart, bEnd });
}

/**
 * What is left after the common prefix and suffix have been trimmed.
 *
 * One object per reconcile — a list update performs exactly one — rather than
 * six parameters through three functions.
 */
type Middle = {
  a: Node[];
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
};

/**
 * Removes what departed, then moves the fewest survivors that have to move.
 *
 * Only the nodes outside a longest increasing subsequence are moved, which is
 * the provably minimal number of `insertBefore` calls.
 */
function reorder(parent: Node, b: Node[], after: Node | null, middle: Middle): void {
  const count = middle.bEnd - middle.bStart + 1;
  const sources = sourcesOf(parent, b, middle);

  const keep = longestIncreasing(sources);
  let k = keep.length - 1;
  let anchor: Node | null = after;
  for (let j = count - 1; j >= 0; j--) {
    const node = b[middle.bStart + j] as Node;
    if (k >= 0 && keep[k] === j) {
      // Already in the right relative order: leave it where it is.
      k--;
    } else {
      parent.insertBefore(node, anchor);
    }
    anchor = node;
  }
}

/**
 * Where each surviving node came from, and the removal of those that did not.
 *
 * `sources[j]` is the old index of the node that ends up at new position j, or
 * -1 when the node is new. Consuming each entry as it is found leaves exactly
 * the departed nodes behind, so the removal pass needs no second set.
 */
function sourcesOf(parent: Node, b: Node[], middle: Middle): Int32Array {
  const { a, aStart, aEnd, bStart, bEnd } = middle;
  const oldIndex = new Map<Node, number>();
  for (let i = aStart; i <= aEnd; i++) {
    oldIndex.set(a[i] as Node, i);
  }
  const count = bEnd - bStart + 1;
  const sources = new Int32Array(count).fill(-1);
  for (let j = 0; j < count; j++) {
    const node = b[bStart + j] as Node;
    const found = oldIndex.get(node);
    if (found !== undefined) {
      sources[j] = found;
      oldIndex.delete(node);
    }
  }
  for (const node of oldIndex.keys()) {
    parent.removeChild(node);
  }
  return sources;
}

/** Indices of a longest increasing subsequence of `sources`, skipping `-1`. */
function longestIncreasing(sources: Int32Array): number[] {
  const length = sources.length;
  const predecessor = new Int32Array(length).fill(-1);
  const tails: number[] = [];
  for (let i = 0; i < length; i++) {
    const value = sources[i] as number;
    if (value === -1) {
      continue;
    }
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((sources[tails[mid] as number] as number) < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    if (low > 0) {
      predecessor[i] = tails[low - 1] as number;
    }
    tails[low] = i;
  }
  const result: number[] = [];
  let cursor = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
  while (cursor !== -1) {
    result.push(cursor);
    cursor = predecessor[cursor] as number;
  }
  return result.reverse();
}
