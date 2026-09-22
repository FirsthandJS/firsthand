import {
  bind,
  createOwner,
  signal,
  disposeOwner,
  getOwner,
  onCleanup,
  runWithOwner,
  setOwner,
  type Owner,
  type Signal,
} from '@firsthandjs/core';
import { devHandedNewFunction, devPart, devRan, devWarnRenderedObject } from './dev.js';
import { hydration, type Claimed } from './claim.js';

/** What a child part currently owns in the DOM. */
export type ChildSlot = Node | Node[] | null;

/**
 * How deep we are inside something whose nodes are being thrown away anyway.
 *
 * A part removes what it inserted when its scope is disposed, because usually
 * nothing else will. A list row is the exception: its nodes are removed by the
 * reconciler, in one go, and everything the row's own parts put *inside* those
 * nodes goes with them. Removing each of those first is work with no effect —
 * measured at 15 ms of the 46 ms it took to clear ten thousand rows, and the
 * same whether it happens before or after the rows are detached.
 *
 * So the list says so, and the parts inside it believe it. Nothing else sets
 * this: a part whose parent might outlive it still cleans up after itself.
 */
let discarding = 0;

/**
 * Runs `body` with the parts inside it excused from removing their nodes.
 *
 * The caller is promising that the nodes those parts wrote into are about to
 * be removed wholesale. `list` is the only caller, and `reconcile` is the
 * promise it is keeping.
 */
export function discard(body: () => void): void {
  discarding++;
  try {
    body();
  } finally {
    discarding--;
  }
}

const TEXT_NODE = 3;

function isNode(value: object): value is Node {
  return typeof (value as Node).nodeType === 'number';
}

const PART: unique symbol = Symbol('firsthand.part');

/**
 * Marks an array as nodes, in order, with nothing to unpack.
 *
 * `applyChild` accepts arrays of anything — nested arrays, thunks, strings,
 * dynamic children — so it walks what it is given and builds a flat list of
 * nodes out of it. A keyed list has already done that walk: it has the nodes,
 * it made the array, and nobody else can reach it. Walking it again is one
 * allocation and ten thousand steps for a list of ten thousand rows.
 */
export const FLAT: unique symbol = Symbol('firsthand.flat');

/**
 * What a keyed list still has to do once its nodes are in the document.
 *
 * A row whose component handed back a render function is a part like any
 * other, and a part cannot be bound where it is made: the list has an array,
 * not a place in the document. So the list puts the row's anchor among its
 * nodes and leaves the binding here, to be run with the parent that was
 * missing — the same two steps `flatten` takes for a fragment's children.
 */
export const PENDING: unique symbol = Symbol('firsthand.pending');

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

/**
 * The parts that are mounted somewhere.
 *
 * A run that keeps what it made hands back the very same part every time it
 * runs — that is what a site is for. Binding it a second time would mount a
 * second copy of it beside the first, with nothing to say the two are the
 * same child, so the page ends up with the component twice.
 *
 * Held here rather than on the part: a `DynamicChild` is part of `View`, which
 * is what an application's own props are typed with, and a field the runtime
 * writes would be a field every one of those types has to carry.
 */
const mounted = new WeakSet<DynamicChild>();

/** Marks a dynamic child of a fragment. Emitted by the compiler. */
export function part(thunk: () => unknown): DynamicChild {
  return { [PART]: true, anchor: document.createTextNode(''), thunk, owner: getOwner() };
}

export function isDynamicChild(value: object): value is DynamicChild {
  return PART in value;
}

/**
 * One place a run writes to, and what it last put there.
 *
 * A render function runs as a whole, so the DOM it describes has to be the DOM
 * it already made: created on the first run, written on every one after. These
 * records are what survives between runs — the node, and the last value, so a
 * run that produces what is already on screen writes nothing.
 */
export type Slot = {
  /** What this site made, or what a write currently owns. */
  node?: ChildSlot;
  /** The last primitive written here, when the last thing written was one. */
  text?: string | undefined;
  /** The last value written to an attribute or a property. */
  last?: unknown;
  /** What the site made besides its node: parts, listeners, components. */
  owner?: Owner;
  /** The run that last reached this site. */
  seen?: number;
  /** A prop a run feeds a child, held so the child keeps its instance. */
  cell?: Signal<unknown>;
};

/**
 * Where a run keeps its sites.
 *
 * One per instance, made in the setup — which runs once, so there is nothing
 * to look up and nothing ambient. What a site makes belongs to `owner`, the
 * component's own, rather than to the run that happened to make it: a run's
 * scope is cleared before it runs again, and anything left there would be
 * disposed by the second run.
 */
export type Store = {
  slots: (Slot | undefined)[];
  owner: Owner | null;
  /** Which run is in progress, so that what it did not reach can be found. */
  generation: number;
  /** The component this belongs to, for what development has to say about it. */
  name: string;
  /** Whether this run has changed anything. Development only. */
  busy?: boolean;
  /** How many runs in a row have changed nothing. Development only. */
  quiet?: number;
};

/** Declared once per instance by the compiler, in the setup. */
export function store(name = ''): Store {
  return { slots: [], owner: getOwner(), generation: 0, name };
}

/** Notes that this run has actually changed something. */
export function wrote(store: Store): void {
  store.busy = true;
}

/** The record for one site, made the first time a run reaches it. */
export function site(store: Store, index: number): Slot {
  const existing = store.slots[index];
  if (existing !== undefined) {
    existing.seen = store.generation;
    return existing;
  }
  const slot: Slot = { seen: store.generation };
  store.slots[index] = slot;
  return slot;
}

/**
 * Opens a site: what it makes now belongs to the instance, not to this run.
 *
 * Returns the owner to restore, which the compiler hands back to `close`.
 */
export function open(store: Store, slot: Slot): Owner | null {
  const owner = createOwner(store.owner);
  slot.owner = owner;
  return setOwner(owner);
}

export function close(previous: Owner | null): void {
  setOwner(previous);
}

/**
 * Ends a run, and disposes what it did not reach.
 *
 * A branch the run has left is gone, not hidden: its components run their
 * cleanups and its parts stop, exactly as if the markup had never been there.
 * Coming back builds it again. That is what the control flow says, so it is
 * what happens.
 */
export function ran<T>(store: Store, value: T): T {
  devRan(store);
  const generation = store.generation;
  const slots = store.slots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot === undefined || slot.seen === generation) {
      continue;
    }
    if (slot.owner !== undefined) {
      disposeOwner(slot.owner);
    }
    slots[i] = undefined;
  }
  store.generation = generation + 1;
  return value;
}

/**
 * A prop whose value belongs to the run, as something the child can hold.
 *
 * The child keeps its instance across runs, so its props cannot be getters
 * over the run that made them — that value belongs to one call. It gets a cell
 * instead, made the first time and written afterwards, so a prop that did not
 * change wakes nothing.
 */
export function cell(store: Store, index: number, value: unknown): Signal<unknown> {
  const slot = site(store, index);
  const existing = slot.cell;
  if (existing === undefined) {
    const made = signal(value);
    slot.cell = made;
    return made;
  }
  if (existing.peek() !== value) {
    devHandedNewFunction(store, value);
    wrote(store);
    existing.value = value;
  }
  return existing;
}

/**
 * Writes a child position a run owns.
 *
 * The same text twice is not a write: `data` would accept it, and measuring
 * says that comparing a remembered string costs half what setting one does.
 * Anything else goes through `applyChild`, where a node that has not moved is
 * recognised and left where it is.
 */
export function writeChild(
  store: Store,
  index: number,
  parent: Node,
  marker: Node | null,
  value: unknown,
): void {
  const slot = site(store, index);
  if (slot.node === undefined && hydration.current !== null) {
    // The first run of a render function over markup the server already sent.
    // The site starts out owning what is there, so the comparisons below find
    // the value already written and the run writes nothing.
    const claimed = hydration.current.claim(parent, marker);
    if (claimed !== null) {
      if (typeof value === 'object' && value !== null && isDynamicChild(value)) {
        // The child's anchor is the client's own — markup has no way to
        // express one — so hydration puts it in place and hands the region to
        // the `insert` below, which is where the child was going to come from
        // anyway.
        slot.last = value;
        hydration.current.keep(slot, parent, value.anchor, claimed);
        runWithOwner(value.owner, () => {
          insert(parent, value.thunk, value.anchor);
        });
        return;
      }
      slot.node = claimed.nodes;
      slot.text = claimed.text;
    }
  }
  const type = typeof value;
  if (type === 'string' || type === 'number') {
    const text = String(value);
    if (text === slot.text) {
      return;
    }
    wrote(store);
    slot.text = text;
    slot.node = applyChild(parent, marker, slot.node ?? null, text);
    return;
  }
  slot.text = undefined;
  // The same thing again is not a write. It is how a child a run keeps stays
  // where it is: the run hands back the very object it handed back last time.
  if (value === slot.last) {
    return;
  }
  wrote(store);
  slot.last = value;
  slot.node = applyChild(parent, marker, slot.node ?? null, value);
}

/**
 * Binds a dynamic child position.
 *
 * `value` is a thunk when the compiler could not prove the expression constant.
 * The thunk is evaluated once inside a tracking scope; if it read nothing
 * reactive, no effect is retained (ADR-0009).
 */
export function insert(
  parent: Node,
  value: unknown,
  marker: Node | null = null,
  /**
   * A region already claimed, handed down rather than looked up.
   *
   * The compiler never passes this. It is how a part that turns out to
   * produce another part gives the markup it claimed to the part that will
   * actually own it — see the `function` branch below.
   */
  seed?: Claimed | null,
  /**
   * Told what this part currently has in the document, after every run.
   *
   * The compiler never passes this either. A keyed list needs it: a row that
   * is a view owns nodes that change without the list running, and a reorder
   * has to move what the row has now rather than what it had when it was
   * made.
   */
  report?: Report,
): void {
  if (typeof value !== 'function') {
    applyChild(parent, marker, null, value);
    return;
  }
  let current: ChildSlot = null;
  /**
   * What this part last wrote, when what it wrote was text.
   *
   * Kept here rather than read back from the node: `text.data` materialises a
   * string out of the DOM, and comparing against it measured *slower* than not
   * comparing at all. Comparing against a remembered value is half the price
   * of writing unconditionally, because most of a view is unchanged on most
   * updates.
   */
  let written: string | undefined;
  // What the server already put here. The first run then finds the value it
  // produces already on the page — the same text, or the very nodes it just
  // adopted — and writes nothing.
  const claimed =
    seed !== undefined
      ? seed
      : hydration.current === null
        ? null
        : hydration.current.claim(parent, marker);
  /** Whether the run in progress is the one that found the markup in place. */
  let adopting = claimed !== null;
  if (claimed !== null) {
    current = claimed.nodes;
    written = claimed.text;
  }
  const body = (): void => {
    run();
    // `marker` is the part's own anchor wherever a report was asked for: only
    // `bindPart` passes one, and it passes the anchor with it.
    report?.(nodesOf(current, marker as Node));
  };
  const run = (): void => {
    const next = (value as () => unknown)();
    const type = typeof next;
    if (type === 'string' || type === 'number') {
      const text = String(next);
      if (text !== written) {
        written = text;
        current = applyChild(parent, marker, current, text);
      }
      return;
    }
    // Anything else replaces the text, so the next identical string is a
    // genuine write rather than a repeat.
    written = undefined;
    if (type === 'function') {
      // The expression produced another *part* rather than a value — a keyed
      // list is the case that matters, as in `cond ? items.map(...) : other`.
      //
      // Mounting it through its own `insert` gives it its own effect, so the
      // data the list reads belongs to the list and not to the expression that
      // selected it. Evaluating it inline instead would make the conditional
      // depend on the list's data, and every change to that data would rebuild
      // every row — which is exactly what the benchmark caught.
      if (adopting) {
        // A component whose setup returned a render function, over markup a
        // server sent. What was claimed belongs to that function's part, not
        // to this one — handed over rather than cleared, which is the
        // difference between adopting the page and rebuilding it.
        current = null;
        insert(parent, next, marker, claimed);
        return;
      }
      current = clear(current);
      insert(parent, next, marker, null);
      return;
    }
    current = applyChild(parent, marker, current, next);
  };
  if (claimed === null) {
    bind(body);
  } else {
    // The first run happens inside the region, so that a `template()` reached
    // from here adopts this child's nodes rather than the next child's.
    // `current` is what produced the claim a moment ago, so it is still here.
    (hydration.current as NonNullable<typeof hydration.current>).within(claimed.region, () => {
      bind(body);
    });
  }
  adopting = false;
  // A dynamic child owns the nodes it inserted, so disposing the scope that
  // created it removes them — including the nodes a nested part inserted.
  // Unless somebody above is removing the whole subtree already: see
  // `discard`.
  onCleanup(() => {
    current = discarding > 0 ? null : clear(current);
  });
}

/** Told what a part has in the document, when somebody needs to know. */
export type Report = (nodes: Node[]) => void;

/**
 * What a part has in the document, as a list, with its anchor at the end.
 *
 * Only a keyed list asks, and only for its rows that are views — so this is
 * not on the path a page of static markup takes, and the allocation is one
 * per row per change rather than one per part per run.
 */
function nodesOf(current: ChildSlot, anchor: Node): Node[] {
  const nodes = current === null ? [] : Array.isArray(current) ? [...current] : [current];
  nodes.push(anchor);
  return nodes;
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
    return clearIn(parent, marker, current);
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
    if (FLAT in value) {
      // Nodes already, in order. The only thing left is to put them in place.
      const rows = value as unknown as Node[];
      if (rows.length === 0) {
        return clearIn(parent, marker, current);
      }
      reconcile(
        parent,
        marker,
        current === null ? [] : Array.isArray(current) ? current : [current],
        rows,
      );
      (value as { [PENDING]?: (parent: Node) => void })[PENDING]?.(parent);
      return rows;
    }
    const next: Node[] = [];
    const dynamic: DynamicChild[] = [];
    flatten(value, next, dynamic);
    if (next.length === 0) {
      return clearIn(parent, marker, current);
    }
    reconcile(
      parent,
      marker,
      current === null ? [] : Array.isArray(current) ? current : [current],
      next,
    );
    // Bound only now: the anchors are in the DOM, so each part has a parent to
    // insert before.
    for (let i = 0; i < dynamic.length; i++) {
      bindPart(dynamic[i] as DynamicChild, parent);
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

/**
 * Binds parts whose anchors are now in the document.
 *
 * Each runs under the owner it was written in, which is what keeps context,
 * disposal and error ownership lexical. A part created outside any scope —
 * runtime JSX at module level, say — is bound under the scope doing the
 * inserting, so that it is still disposed by something rather than by nothing.
 *
 * A part that is already mounted is left alone. A run hands back what it made
 * rather than making it again, so the same part arrives here on every run of
 * the run that owns it, and binding it twice would put a second copy of the
 * whole child on the page beside the first.
 */
export function bindPart(child: DynamicChild, parent: Node, report?: Report): void {
  if (mounted.has(child)) {
    return;
  }
  mounted.add(child);
  runWithOwner(child.owner ?? getOwner(), () => {
    insert(parent, child.thunk, child.anchor, undefined, report);
    // Forgotten when the part is disposed, because a child a conditional takes
    // away and puts back is the same object and does need mounting again.
    onCleanup(() => {
      mounted.delete(child);
    });
  });
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

/**
 * Empties a child slot that is everything its parent has.
 *
 * Removing ten thousand rows one at a time is ten thousand mutations, each one
 * a chance for the engine to do bookkeeping it is about to throw away. When
 * the slot *is* the parent's content — no marker after it, nothing beside it —
 * the platform has one call that says so, and it is what clearing a table
 * actually costs: `removeChild` was 85 % of that scenario before this.
 *
 * Falls back to removing them one by one whenever the slot is anything less
 * than the whole, including when a node has been moved out from under it.
 */
function clearIn(parent: Node, marker: Node | null, current: ChildSlot): null {
  if (
    marker === null &&
    Array.isArray(current) &&
    current.length > 1 &&
    parent.childNodes.length === current.length
  ) {
    (parent as Element).textContent = '';
    return null;
  }
  return clear(current);
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
