/**
 * The keyed-reconciliation candidates from ADR-0010.
 *
 * All have the same signature and the same contract: given the node list a
 * parent currently holds (`a`) and the list it should hold (`b`), both in the
 * order they must appear before `marker`, make the DOM match with as little
 * work as possible, reusing every node that appears in both.
 *
 * `shipped` is imported from the package rather than copied, so this comparison
 * cannot drift away from what applications actually run. The other two are the
 * alternatives it was chosen over, kept here so the choice stays re-checkable
 * on a future engine.
 */

export { reconcile as shipped } from '@firsthandjs/dom/internal';

/**
 * The two-ended scan.
 *
 * Trims the common prefix and suffix, removes what is gone, then walks the new
 * middle backwards inserting anything that is not already in front of its
 * successor. No index map beyond a survivor set, no ordering analysis — and no
 * way to know that a two-element swap needs only two moves, so it issues one
 * per surviving node.
 */
export function prefixSuffix(parent, marker, a, b) {
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

  const after = bEnd + 1 < b.length ? b[bEnd + 1] : marker;

  if (aStart > aEnd) {
    for (let i = bStart; i <= bEnd; i++) {
      parent.insertBefore(b[i], after);
    }
    return;
  }
  if (bStart > bEnd) {
    for (let i = aStart; i <= aEnd; i++) {
      parent.removeChild(a[i]);
    }
    return;
  }

  const survivors = new Set();
  for (let i = bStart; i <= bEnd; i++) {
    survivors.add(b[i]);
  }
  for (let i = aStart; i <= aEnd; i++) {
    const node = a[i];
    if (!survivors.has(node)) {
      parent.removeChild(node);
    }
  }
  let anchor = after;
  for (let i = bEnd; i >= bStart; i--) {
    const node = b[i];
    if (node.parentNode !== parent || node.nextSibling !== anchor) {
      parent.insertBefore(node, anchor);
    }
    anchor = node;
  }
}

/**
 * Remove everything that is gone, then insert every node in order.
 *
 * Trivially correct and it does reuse nodes, but it touches every surviving
 * node on every change. It is the floor: a candidate that cannot beat it is not
 * worth its complexity.
 */
export function naive(parent, marker, a, b) {
  const survivors = new Set(b);
  for (let i = 0; i < a.length; i++) {
    const node = a[i];
    if (!survivors.has(node)) {
      parent.removeChild(node);
    }
  }
  let anchor = marker;
  for (let i = b.length - 1; i >= 0; i--) {
    const node = b[i];
    parent.insertBefore(node, anchor);
    anchor = node;
  }
}
