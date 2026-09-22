/**
 * A dynamic child position: what fills it, and when it is filled again.
 *
 * `insert` binds one; `applyChild` writes whatever a part produced into one.
 * The two are mutually recursive by nature — an array of children is children —
 * which is why they are one module rather than two.
 */

import { bind, getOwner, onCleanup, runWithOwner, type Owner } from '@firsthandjs/core';

import { hydration, type Claimed } from './claim.js';

import { devPart, devWarnRenderedObject } from './dev.js';

import { TEXT_NODE, clear, clearIn, isNode, single, type ChildSlot } from './nodes.js';

import { reconcile } from './reconcile.js';

export type { ChildSlot } from './nodes.js';

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
 * What only the runtime passes, and the compiler never does.
 *
 * Two hand-offs that exist for one caller each, grouped rather than added to
 * the signature: `insert` is the compiler/runtime protocol, and its arity is
 * part of that protocol (ARCHITECTURE section 1.1). Both paths that pass this
 * happen once per part rather than once per row, so the object costs nothing
 * anybody can measure.
 */
export type InsertOptions = {
  /**
   * A region already claimed, handed down rather than looked up.
   *
   * How a part that turns out to produce another part gives the markup it
   * claimed to the part that will actually own it — see the `function` branch
   * in `run` below.
   */
  seed?: Claimed | null;
  /**
   * Told what this part currently has in the document, after every run.
   *
   * A keyed list needs it: a row that is a view owns nodes that change without
   * the list running, and a reorder has to move what the row has now rather
   * than what it had when it was made.
   */
  report?: Report;
};

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
  options?: InsertOptions,
): void {
  if (typeof value !== 'function') {
    applyChild(parent, marker, null, value);
    return;
  }
  // What the server already put here. The first run then finds the value it
  // produces already on the page — the same text, or the very nodes it just
  // adopted — and writes nothing.
  const claimed = claimFor(parent, marker, options?.seed);
  let current: ChildSlot = claimed === null ? null : claimed.nodes;
  /**
   * What this part last wrote, when what it wrote was text.
   *
   * Kept here rather than read back from the node: `text.data` materialises a
   * string out of the DOM, and comparing against it measured *slower* than not
   * comparing at all. Comparing against a remembered value is half the price
   * of writing unconditionally, because most of a view is unchanged on most
   * updates.
   */
  let written = claimed?.text;
  /** Whether the run in progress is the one that found the markup in place. */
  let adopting = claimed !== null;
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
      //
      // While adopting, what was claimed belongs to that function's part
      // rather than to this one: handed over rather than cleared, which is the
      // difference between adopting the page and rebuilding it.
      current = adopting ? null : clear(current);
      insert(parent, next, marker, { seed: adopting ? claimed : null });
      return;
    }
    current = applyChild(parent, marker, current, next);
  };
  // A report is a frame on every run, so a part nobody asked about is bound to
  // `run` itself. `marker` is the part's own anchor wherever one was asked for:
  // only `bindPart` asks, and it passes the anchor with it.
  const report = options?.report;
  bindIn(
    claimed,
    report === undefined
      ? run
      : () => {
          run();
          report(nodesOf(current, marker as Node));
        },
  );
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

/**
 * The region this part adopts, if any.
 *
 * `undefined` means nobody handed one down, so ask hydration; `null` means a
 * caller looked and there was nothing.
 */
function claimFor(
  parent: Node,
  marker: Node | null,
  seed: Claimed | null | undefined,
): Claimed | null {
  if (seed !== undefined) {
    return seed;
  }
  return hydration.current === null ? null : hydration.current.claim(parent, marker);
}

/**
 * Runs the first pass, inside the claimed region when there is one.
 *
 * Inside, so that a `template()` reached from here adopts this child's nodes
 * rather than the next child's.
 */
function bindIn(claimed: Claimed | null, body: () => void): void {
  if (claimed === null) {
    bind(body);
    return;
  }
  (hydration.current as NonNullable<typeof hydration.current>).within(claimed.region, () => {
    bind(body);
  });
}

/**
 * Applies one value to a child slot and returns the slot's new contents.
 *
 * The two branches that answer for almost every write are first and inline:
 * nothing, and a primitive. Everything else is a shape that costs more than the
 * call to reach it, so it lives in `applyOther` and this function stays small
 * enough to read in one go.
 */
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
  return applyOther(parent, marker, current, value);
}

/** Everything that is not nothing and not a primitive. */
function applyOther(
  parent: Node,
  marker: Node | null,
  current: ChildSlot,
  value: unknown,
): ChildSlot {
  if (typeof value === 'function') {
    return applyChild(parent, marker, current, (value as () => unknown)());
  }
  if (Array.isArray(value)) {
    return applyArray(parent, marker, current, value);
  }
  if (isDynamicChild(value as object)) {
    // A fragment with a single dynamic child. The array path already knows how
    // to anchor and bind one, so reuse it rather than duplicating the logic.
    return applyArray(parent, marker, current, [value]);
  }
  if (isNode(value as object)) {
    return single(parent, marker, current, value as Node);
  }
  // Everything else is stringified, which is the platform's own behaviour —
  // but an object here is almost always a mistake, most often a signal read
  // without `.value`, so development says so.
  devWarnRenderedObject(value as object);
  return applyChild(parent, marker, current, String(value));
}

/** What the slot already has, as the list `reconcile` compares against. */
function asList(current: ChildSlot): Node[] {
  return current === null ? [] : Array.isArray(current) ? current : [current];
}

/**
 * An array of children, reconciled into place.
 *
 * A keyed list has already flattened itself and says so with `FLAT`: it has the
 * nodes, it made the array, and nobody else can reach it. Walking it again
 * would be one allocation and ten thousand steps for a list of ten thousand
 * rows.
 */
function applyArray(
  parent: Node,
  marker: Node | null,
  current: ChildSlot,
  value: readonly unknown[],
): ChildSlot {
  if (FLAT in value) {
    const rows = value as unknown as Node[];
    if (rows.length === 0) {
      return clearIn(parent, marker, current);
    }
    reconcile(parent, marker, asList(current), rows);
    (value as { [PENDING]?: (parent: Node) => void })[PENDING]?.(parent);
    return rows;
  }
  const next: Node[] = [];
  const dynamic: DynamicChild[] = [];
  flatten(value, next, dynamic);
  if (next.length === 0) {
    return clearIn(parent, marker, current);
  }
  reconcile(parent, marker, asList(current), next);
  // Bound only now: the anchors are in the DOM, so each part has a parent to
  // insert before.
  for (let i = 0; i < dynamic.length; i++) {
    bindPart(dynamic[i] as DynamicChild, parent);
  }
  return next;
}

/**
 * Binds parts whose anchors are now in the document.
 *
 * Each runs under the owner it was written in, which is what keeps context,
 * disposal and error ownership lexical. A part created outside any scope —
 * runtime JSX at module level, say — is bound under the scope doing the
 * inserting, so that it is still disposed by something rather than by nothing.
 */
export function bindPart(child: DynamicChild, parent: Node, report?: Report): void {
  if (mounted.has(child)) {
    return;
  }
  mounted.add(child);
  runWithOwner(child.owner ?? getOwner(), () => {
    insert(parent, child.thunk, child.anchor, report === undefined ? undefined : { report });
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
