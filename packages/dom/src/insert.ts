import { bind, getOwner, onCleanup, runWithOwner, type Owner } from '@firsthandjs/core';
import { devPart, devWarnRenderedObject } from './dev.js';

/** What a child part currently owns in the DOM. */
export type ChildSlot = Node | Node[] | null;

const TEXT_NODE = 3;

function isNode(value: object): value is Node {
  return typeof (value as Node).nodeType === 'number';
}

const PART: unique symbol = Symbol('firsthand.part');

/**
 * A dynamic child inside an array, carrying the scope it was written in.
 *
 * A fragment has no element of its own, so its children cannot be bound when
 * they are created: there is no parent to insert into yet. Deferring the whole
 * child to insertion time would evaluate it under whoever performs the
 * insertion — the wrong scope, which loses context and disposal, and which does
 * not make it reactive at all.
 *
 * So a fragment's dynamic child is emitted as one of these: an anchor that
 * takes its place in the array, plus the expression and the owner it belongs
 * to. Once the array is in the DOM, each one is bound through `insert` under
 * its own owner, exactly as a child of a real element would be.
 */
export type DynamicChild = {
  readonly [PART]: true;
  readonly anchor: Text;
  readonly thunk: () => unknown;
  readonly owner: Owner | null;
};

/** Marks a dynamic child of a fragment. Emitted by the compiler. */
export function part(thunk: () => unknown): DynamicChild {
  return { [PART]: true, anchor: document.createTextNode(''), thunk, owner: getOwner() };
}

function isDynamicChild(value: object): value is DynamicChild {
  return PART in value;
}

/**
 * Binds a dynamic child position.
 *
 * `value` is a thunk when the compiler could not prove the expression constant.
 * The thunk is evaluated once inside a tracking scope; if it read nothing
 * reactive, no effect is retained (ADR-0009).
 */
export function insert(parent: Node, value: unknown, marker: Node | null = null): void {
  if (typeof value !== 'function') {
    applyChild(parent, marker, null, value);
    return;
  }
  let current: ChildSlot = null;
  bind(() => {
    const next = (value as () => unknown)();
    if (typeof next === 'function') {
      // The expression produced another *part* rather than a value — a keyed
      // list is the case that matters, as in `cond ? items.map(...) : other`.
      //
      // Mounting it through its own `insert` gives it its own effect, so the
      // data the list reads belongs to the list and not to the expression that
      // selected it. Evaluating it inline instead would make the conditional
      // depend on the list's data, and every change to that data would rebuild
      // every row — which is exactly what the benchmark caught.
      current = clear(current);
      insert(parent, next, marker);
      return;
    }
    current = applyChild(parent, marker, current, next);
  });
  // A dynamic child owns the nodes it inserted, so disposing the scope that
  // created it removes them — including the nodes a nested part inserted.
  onCleanup(() => {
    current = clear(current);
  });
}

/** Applies one value to a child slot and returns the slot's new contents. */
export function applyChild(
  parent: Node,
  marker: Node | null,
  current: ChildSlot,
  value: unknown,
): ChildSlot {
  const type = typeof value;
  if (value == null || type === 'boolean') {
    // Reported here too, not only when there is text: a part that currently
    // renders nothing still writes this node, and devtools that only knew
    // about it once it had a value would go quiet exactly when someone is
    // asking why the node is empty.
    devPart(parent, 'text');
    return clear(current);
  }
  if (type === 'string' || type === 'number') {
    // Devtools attribute this write to the effect that is running, which is how
    // `{count.value}` becomes `p.text` rather than an anonymous effect.
    devPart(parent, 'text');
    const text = String(value);
    if (current !== null && !Array.isArray(current) && current.nodeType === TEXT_NODE) {
      // The fast path that matters: one property write, no allocation.
      (current as Text).data = text;
      return current;
    }
    return single(parent, marker, current, document.createTextNode(text));
  }
  if (type === 'function') {
    return applyChild(parent, marker, current, (value as () => unknown)());
  }
  if (Array.isArray(value)) {
    const next: Node[] = [];
    const dynamic: DynamicChild[] = [];
    flatten(value, next, dynamic);
    if (next.length === 0) {
      return clear(current);
    }
    reconcile(
      parent,
      marker,
      current === null ? [] : Array.isArray(current) ? current : [current],
      next,
    );
    // Bound only now: the anchors are in the DOM, so each part has a parent to
    // insert before. Each runs under the owner it was written in, which is what
    // keeps context, disposal and error ownership lexical.
    for (let i = 0; i < dynamic.length; i++) {
      const child = dynamic[i] as DynamicChild;
      // A part created outside any scope — runtime JSX at module level, say —
      // is bound under the scope doing the inserting, so that it is still
      // disposed by something rather than by nothing.
      runWithOwner(child.owner ?? getOwner(), () => {
        insert(parent, child.thunk, child.anchor);
      });
    }
    return next;
  }
  if (isDynamicChild(value)) {
    // A fragment with a single dynamic child. The array path already knows how
    // to anchor and bind one, so reuse it rather than duplicating the logic.
    return applyChild(parent, marker, current, [value]);
  }
  if (isNode(value)) {
    return single(parent, marker, current, value);
  }
  // Everything else is stringified, which is the platform's own behaviour —
  // but an object here is almost always a mistake, most often a signal read
  // without `.value`, so development says so.
  devWarnRenderedObject(value);
  return applyChild(parent, marker, current, String(value));
}

/** Flattens nested arrays, thunks and primitives into a list of DOM nodes. */
function flatten(value: readonly unknown[], out: Node[], dynamic: DynamicChild[]): void {
  for (let i = 0; i < value.length; i++) {
    let item = value[i];
    if (typeof item === 'object' && item !== null && isDynamicChild(item)) {
      out.push(item.anchor);
      dynamic.push(item);
      continue;
    }
    while (typeof item === 'function') {
      item = (item as () => unknown)();
    }
    if (item == null || typeof item === 'boolean') {
      continue;
    }
    if (Array.isArray(item)) {
      flatten(item, out, dynamic);
    } else if (typeof item === 'object' && isNode(item)) {
      out.push(item);
    } else {
      out.push(document.createTextNode(String(item)));
    }
  }
}

/**
 * Removes a node from wherever it currently is.
 *
 * Usually that is `parent`, but a node can legitimately have been moved — an
 * element host relocated in the document, for instance — and disposal must
 * still clean up rather than throw.
 */
function detach(node: Node): void {
  const owner = node.parentNode;
  if (owner !== null) {
    owner.removeChild(node);
  }
}

function clear(current: ChildSlot): null {
  if (current !== null) {
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        detach(current[i] as Node);
      }
    } else {
      detach(current);
    }
  }
  return null;
}

function single(parent: Node, marker: Node | null, current: ChildSlot, node: Node): Node {
  if (current === node) {
    return node;
  }
  if (current !== null && !Array.isArray(current)) {
    parent.replaceChild(node, current);
    return node;
  }
  clear(current);
  parent.insertBefore(node, marker);
  return node;
}

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

  // Where each surviving node sits in the old middle.
  const oldIndex = new Map<Node, number>();
  for (let i = aStart; i <= aEnd; i++) {
    oldIndex.set(a[i] as Node, i);
  }

  const middle = bEnd - bStart + 1;
  // `sources[j]` is the old index of the node that ends up at new position j,
  // or -1 when the node is new.
  const sources = new Int32Array(middle).fill(-1);
  for (let j = 0; j < middle; j++) {
    const node = b[bStart + j] as Node;
    const found = oldIndex.get(node);
    if (found !== undefined) {
      sources[j] = found;
      // Consuming the entry leaves exactly the departed nodes behind, so the
      // removal pass needs no second set.
      oldIndex.delete(node);
    }
  }
  for (const node of oldIndex.keys()) {
    parent.removeChild(node);
  }

  const keep = longestIncreasing(sources);
  let k = keep.length - 1;
  let anchor: Node | null = after;
  for (let j = middle - 1; j >= 0; j--) {
    const node = b[bStart + j] as Node;
    if (k >= 0 && keep[k] === j) {
      // Already in the right relative order: leave it where it is.
      k--;
    } else {
      parent.insertBefore(node, anchor);
    }
    anchor = node;
  }
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
