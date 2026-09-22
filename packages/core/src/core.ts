/**
 * The reactive graph, the owner tree and the scheduler.
 *
 * These three live in one module because they are one algorithm: an effect run
 * needs to reset its owner scope, and owner disposal needs to unlink graph
 * edges. Splitting them would buy a module boundary and cost an indirection in
 * the hottest path in the framework. The public API is layered on top in
 * `signal.ts`, `computed.ts`, `effect.ts`, `lifecycle.ts` and `context.ts`.
 *
 * Model (ADR-0001): a write pushes *invalidation* through the subscriber graph
 * and queues effects; values are pulled lazily on read. Nothing recomputes
 * during a write.
 *
 * Edges (ADR-0002): every dependency is one reusable doubly-linked `Link`
 * object participating in two intrusive lists. Re-running a node walks its
 * existing dependency list in order and reuses links in place, so the common
 * case allocates nothing.
 */

import { DIRTY, DISPOSED, HAS_VALUE, MUTABLE, PENDING, STALE, WATCHING } from './flags.js';
import { FirsthandCycleError, FirsthandReadonlyError } from './errors.js';
import {
  devCause,
  devCheckSetupRead,
  devEnterSnapshot,
  devExitSnapshot,
  devRunning,
  reportUncaught,
} from './dev.js';

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

/** One dependency edge, shared by the source's subscriber list and the
 *  subscriber's dependency list. */
export class Link {
  declare dep: Cell;
  declare sub: Cell;
  declare prevDep: Link | undefined;
  declare nextDep: Link | undefined;
  declare prevSub: Link | undefined;
  declare nextSub: Link | undefined;

  constructor(
    dep: Cell,
    sub: Cell,
    prevDep: Link | undefined,
    nextDep: Link | undefined,
    prevSub: Link | undefined,
  ) {
    this.dep = dep;
    this.sub = sub;
    this.prevDep = prevDep;
    this.nextDep = nextDep;
    this.prevSub = prevSub;
    this.nextSub = undefined;
  }
}

/** Default equality. `Object.is` so that `NaN` settles and `-0`/`+0` differ. */
const is = Object.is;
/** Equality for `{ equals: false }`: every write propagates. */
const never = (): boolean => false;

/**
 * One node of the reactive graph. Signals, computeds and effects all use this
 * class so that every property access in the graph code sees one hidden class.
 */
export class Cell {
  declare flags: number;
  /** Signal value, or the memoised result of `fn`. */
  declare v: unknown;
  /** Computed body, or effect body. `undefined` for signals. */
  declare fn: (() => unknown) | undefined;
  declare equals: (a: unknown, b: unknown) => boolean;
  declare deps: Link | undefined;
  declare depsTail: Link | undefined;
  declare subs: Link | undefined;
  declare subsTail: Link | undefined;
  /** An effect's own scope: re-created on every run. `undefined` otherwise. */
  declare scope: Owner | undefined;

  constructor(
    flags: number,
    value: unknown,
    fn: (() => unknown) | undefined,
    equals: (a: unknown, b: unknown) => boolean,
  ) {
    this.flags = flags;
    this.v = value;
    this.fn = fn;
    this.equals = equals;
    this.deps = undefined;
    this.depsTail = undefined;
    this.subs = undefined;
    this.subsTail = undefined;
    this.scope = undefined;
  }

  get value(): unknown {
    const flags = this.flags;
    if ((flags & MUTABLE) !== 0 && (flags & STALE) !== 0) {
      refresh(this);
    }
    if (activeSub !== undefined) {
      link(this, activeSub);
    } else {
      // Nothing is subscribing. Ordinary outside a component — an event
      // handler reading current state — and the whole of the single-run
      // mistake inside one, which is what strict reactivity reports. Empty in
      // a production build, so the hot path keeps its single branch.
      devCheckSetupRead();
    }
    return this.v;
  }

  set value(next: unknown) {
    if ((this.flags & MUTABLE) !== 0) {
      throw new FirsthandReadonlyError();
    }
    write(this, next);
  }

  /** Reads without subscribing, and without refreshing lazily... except that a
   *  stale computed must still produce a correct value, so it does refresh. */
  peek(): unknown {
    const flags = this.flags;
    if ((flags & MUTABLE) !== 0 && (flags & STALE) !== 0) {
      refresh(this);
    }
    return this.v;
  }

  /** Functional update. The updater runs untracked. */
  set(updater: (previous: never) => unknown): void {
    if ((this.flags & MUTABLE) !== 0) {
      throw new FirsthandReadonlyError();
    }
    write(this, updater(this.v as never));
  }
}

/**
 * A logical scope (ADR-0008). Owners form a tree that is independent of the
 * DOM, which is what lets portals keep their context and disposal behaviour.
 */
export type Owner = {
  parent: Owner | null;
  /** Whether the owner is still in its parent's child list. */
  attached: boolean;
  prev: Owner | null;
  next: Owner | null;
  head: Owner | null;
  tail: Owner | null;
  /** Cleanup callbacks, in registration order. Allocated on first use. */
  disposals: (() => void)[] | null;
  /** Computeds and effects to unlink on disposal. Allocated on first use. */
  cells: Cell[] | null;
  /** Prototype-chained context record, shared by reference until `provide`. */
  ctx: ContextRecord | null;
  /** Error boundary installed by `catchError`. */
  handler: ((error: unknown) => void) | null;
};

export type ContextRecord = Record<symbol, unknown>;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

/** The node currently evaluating, i.e. the one that collects dependencies. */
let activeSub: Cell | undefined;
/** The scope new owners, cleanups and cells attach to. */
let currentOwner: Owner | null = null;
/**
 * A scope that has been described but not made yet. See `deferOwner`.
 *
 * Two variables rather than one nullable parent, because the parent of a
 * deferred scope is legitimately `null` — a root has no owner above it, and
 * "no parent" must not read as "nothing deferred".
 */
let deferred = false;
let deferredParent: Owner | null = null;

let batchDepth = 0;
let flushing = false;
let queueIndex = 0;
const queue: (Cell | undefined)[] = [];

/**
 * Upper bound on effect executions within one flush. A genuine cycle reaches it
 * in milliseconds; legitimate work does not — the largest scenario in the
 * benchmark suite (100 000 rows, each with its own effect) runs 100 000 steps.
 */
const MAX_FLUSH_STEPS = 1_000_000;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Subscribes `sub` to `dep`, reusing the link already at this position of
 * `sub`'s dependency list when the dependency order is unchanged.
 */
function link(dep: Cell, sub: Cell): void {
  const prevDep = sub.depsTail;
  if (prevDep !== undefined && prevDep.dep === dep) {
    // Same source read twice in a row.
    return;
  }
  const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    // The common case: dependency order is unchanged, so reuse the link.
    sub.depsTail = nextDep;
    return;
  }
  const prevSub = dep.subsTail;
  if (prevSub !== undefined && prevSub.sub === sub && isTracked(prevSub, sub)) {
    // Same source read twice in one run, out of order.
    return;
  }
  const newLink = new Link(dep, sub, prevDep, nextDep, prevSub);
  sub.depsTail = newLink;
  dep.subsTail = newLink;
  if (nextDep !== undefined) {
    nextDep.prevDep = newLink;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = newLink;
  } else {
    sub.deps = newLink;
  }
  if (prevSub !== undefined) {
    prevSub.nextSub = newLink;
  } else {
    dep.subs = newLink;
  }
}

/** Whether `candidate` was already visited during the current run of `sub`. */
function isTracked(candidate: Link, sub: Cell): boolean {
  let link = sub.depsTail;
  while (link !== undefined) {
    if (link === candidate) {
      return true;
    }
    link = link.prevDep;
  }
  return false;
}

/** Removes one edge from both lists and returns the subscriber's next edge. */
function unlink(edge: Link, sub: Cell): Link | undefined {
  const dep = edge.dep;
  const prevDep = edge.prevDep;
  const nextDep = edge.nextDep;
  const prevSub = edge.prevSub;
  const nextSub = edge.nextSub;
  if (nextDep !== undefined) {
    nextDep.prevDep = prevDep;
  } else {
    sub.depsTail = prevDep;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = nextDep;
  } else {
    sub.deps = nextDep;
  }
  if (nextSub !== undefined) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== undefined) {
    prevSub.nextSub = nextSub;
  } else {
    dep.subs = nextSub;
  }
  return nextDep;
}

function startTracking(sub: Cell): void {
  sub.depsTail = undefined;
  sub.flags &= ~STALE;
}

/** Drops every dependency the finished run did not re-observe. */
function endTracking(sub: Cell): void {
  const depsTail = sub.depsTail;
  let stale = depsTail !== undefined ? depsTail.nextDep : sub.deps;
  while (stale !== undefined) {
    stale = unlink(stale, sub);
  }
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/** Invalidates subscribers of a source whose value definitely changed. */
function propagate(from: Link): void {
  let edge: Link | undefined = from;
  do {
    const sub = edge.sub;
    const flags = sub.flags;
    if ((flags & DIRTY) === 0) {
      sub.flags = flags | DIRTY;
      if ((flags & PENDING) === 0) {
        // Not reached yet in this pass, so propagate onwards.
        if ((flags & WATCHING) !== 0) {
          enqueue(sub);
        } else if (sub.subs !== undefined) {
          propagateMaybe(sub.subs);
        }
      }
    }
    edge = edge.nextSub;
  } while (edge !== undefined);
}

/** Invalidates subscribers of a computed that may or may not have changed. */
function propagateMaybe(from: Link): void {
  let edge: Link | undefined = from;
  do {
    const sub = edge.sub;
    const flags = sub.flags;
    if ((flags & STALE) === 0) {
      sub.flags = flags | PENDING;
      if ((flags & WATCHING) !== 0) {
        enqueue(sub);
      } else if (sub.subs !== undefined) {
        propagateMaybe(sub.subs);
      }
    }
    edge = edge.nextSub;
  } while (edge !== undefined);
}

/**
 * Upgrades "something above you may have changed" to "it did".
 *
 * Reached when a computed is refreshed during a pull: its other subscribers
 * were marked `PENDING` by the original propagation, and `PENDING` is resolved
 * by looking at whether a dependency is still marked stale. Refreshing clears
 * that mark, so a subscriber checked *after* this one would find a clean
 * dependency and conclude, wrongly, that it is up to date. Telling the
 * subscribers now is what keeps the pull phase order-independent.
 */
function shallowPropagate(from: Link): void {
  let edge: Link | undefined = from;
  do {
    const sub = edge.sub;
    const flags = sub.flags;
    if ((flags & STALE) === PENDING) {
      sub.flags = flags | DIRTY;
    }
    edge = edge.nextSub;
  } while (edge !== undefined);
}

function write(cell: Cell, next: unknown): void {
  if (cell.equals(cell.v, next)) {
    return;
  }
  // The one fact the graph does not keep: what changed. Devtools pair it with
  // the effects that run before the next write, which is what turns "this
  // effect ran" into "this effect ran because `order.status` changed". Placed
  // here rather than in the propagation loops, which are the hot path.
  devCause(cell);
  cell.v = next;
  const subs = cell.subs;
  if (subs !== undefined) {
    propagate(subs);
    if (batchDepth === 0) {
      flush();
    }
  }
}

// ---------------------------------------------------------------------------
// Pull evaluation
// ---------------------------------------------------------------------------

/** Brings a stale computed up to date. Returns whether its value changed. */
function refresh(cell: Cell): boolean {
  const flags = cell.flags;
  if ((flags & DIRTY) !== 0 || checkDirty(cell)) {
    if (!evaluate(cell)) {
      return false;
    }
    const subs = cell.subs;
    // With a single subscriber there is nobody to tell: that subscriber is the
    // one that asked for this refresh.
    if (subs !== undefined && subs.nextSub !== undefined) {
      shallowPropagate(subs);
    }
    return true;
  }
  cell.flags = cell.flags & ~PENDING;
  return false;
}

/** Whether any dependency of a PENDING node actually changed. */
function checkDirty(cell: Cell): boolean {
  let edge = cell.deps;
  while (edge !== undefined) {
    const dep = edge.dep;
    if ((dep.flags & MUTABLE) !== 0 && (dep.flags & STALE) !== 0 && refresh(dep)) {
      return true;
    }
    edge = edge.nextDep;
  }
  return false;
}

/** Re-runs a computed body and reports whether the memoised value changed. */
function evaluate(cell: Cell): boolean {
  const prevSub = activeSub;
  const prevOwner = currentOwner;
  const prevDeferred = deferred;
  activeSub = cell;
  currentOwner = null;
  deferred = false;
  startTracking(cell);
  try {
    const next = (cell.fn as () => unknown)();
    // The first evaluation always counts as a change: there is no previous
    // value, and a custom `equals` must never be handed a phantom `undefined`.
    if ((cell.flags & HAS_VALUE) !== 0 && cell.equals(cell.v, next)) {
      return false;
    }
    cell.flags |= HAS_VALUE;
    cell.v = next;
    return true;
  } finally {
    endTracking(cell);
    activeSub = prevSub;
    currentOwner = prevOwner;
    deferred = prevDeferred;
  }
}

// ---------------------------------------------------------------------------
// Scheduling (ADR-0006)
// ---------------------------------------------------------------------------

/**
 * Schedules an effect.
 *
 * There is no "already queued?" guard, because both callers have just
 * established that the node was not stale, and an effect is queued only while
 * it is stale: `flush` clears the queue entry and the staleness together. A
 * duplicate entry would in any case be harmless — the second visit finds the
 * node clean and only drops its `PENDING` mark — so the check would cost a
 * branch in the write path to prevent something that cannot happen.
 */
function enqueue(cell: Cell): void {
  queue.push(cell);
}

function flush(): void {
  if (flushing) {
    // A write from inside an effect: the running loop picks it up.
    return;
  }
  flushing = true;
  let steps = 0;
  try {
    while (queueIndex < queue.length) {
      const cell = queue[queueIndex] as Cell;
      queue[queueIndex++] = undefined;
      if ((cell.flags & DISPOSED) !== 0) {
        continue;
      }
      if (++steps > MAX_FLUSH_STEPS) {
        throw new FirsthandCycleError();
      }
      if ((cell.flags & DIRTY) !== 0 || checkDirty(cell)) {
        runEffect(cell);
      } else {
        cell.flags &= ~PENDING;
      }
    }
  } finally {
    queue.length = 0;
    queueIndex = 0;
    flushing = false;
  }
}

function runEffect(cell: Cell): void {
  const scope = cell.scope as Owner;
  clearScope(scope);
  const prevSub = activeSub;
  const prevOwner = currentOwner;
  const prevDeferred = deferred;
  activeSub = cell;
  currentOwner = scope;
  deferred = false;
  startTracking(cell);
  // Devtools attribute every DOM write made below to this effect, which is how
  // a part learns that it is `Button.disabled` without the DOM layer and the
  // core knowing anything about each other.
  devRunning(cell);
  try {
    const cleanup = (cell.fn as () => unknown)();
    if (typeof cleanup === 'function') {
      (scope.disposals ??= []).push(cleanup as () => void);
    }
  } catch (error) {
    handleError(error, scope);
  } finally {
    devRunning(null);
    endTracking(cell);
    activeSub = prevSub;
    currentOwner = prevOwner;
    deferred = prevDeferred;
  }
}

// ---------------------------------------------------------------------------
// Owners (ADR-0008)
// ---------------------------------------------------------------------------

export function createOwner(parent: Owner | null): Owner {
  const owner: Owner = {
    parent,
    attached: parent !== null,
    prev: null,
    next: null,
    head: null,
    tail: null,
    disposals: null,
    cells: null,
    // Inherited by reference: `provide` is what allocates a record.
    ctx: parent !== null ? parent.ctx : null,
    handler: null,
  };
  if (parent !== null) {
    const tail = parent.tail;
    owner.prev = tail;
    if (tail !== null) {
      tail.next = owner;
    } else {
      parent.head = owner;
    }
    parent.tail = owner;
  }
  return owner;
}

/** Runs cleanups and disposes children, leaving the owner itself reusable. */
function clearScope(owner: Owner): void {
  let child = owner.head;
  while (child !== null) {
    const next = child.next;
    // `parent` is kept so that an error thrown by a cleanup still finds the
    // boundary above; only the child-list membership is dropped.
    child.attached = false;
    child.prev = null;
    child.next = null;
    clearScope(child);
    child = next;
  }
  owner.head = null;
  owner.tail = null;
  // Drop anything this scope provided, but keep what it inherits: an effect
  // scope is cleared and reused on every run and must still see its context.
  owner.ctx = owner.parent !== null ? owner.parent.ctx : null;

  const cells = owner.cells;
  if (cells !== null) {
    for (let i = cells.length - 1; i >= 0; i--) {
      disposeCell(cells[i] as Cell);
    }
    owner.cells = null;
  }

  const disposals = owner.disposals;
  if (disposals !== null) {
    owner.disposals = null;
    for (let i = disposals.length - 1; i >= 0; i--) {
      try {
        (disposals[i] as () => void)();
      } catch (error) {
        handleError(error, owner);
      }
    }
  }
}

/** Disposes an owner and detaches it from its parent. */
export function disposeOwner(owner: Owner): void {
  if (owner.attached) {
    const parent = owner.parent as Owner;
    const prev = owner.prev;
    const next = owner.next;
    if (prev !== null) {
      prev.next = next;
    } else {
      parent.head = next;
    }
    if (next !== null) {
      next.prev = prev;
    } else {
      parent.tail = prev;
    }
    owner.attached = false;
    owner.prev = null;
    owner.next = null;
  }
  clearScope(owner);
}

/** Unsubscribes a cell in both directions and marks it permanently dead. */
export function disposeCell(cell: Cell): void {
  cell.flags |= DISPOSED;
  let dep = cell.deps;
  while (dep !== undefined) {
    dep = unlink(dep, cell);
  }
  let sub = cell.subs;
  while (sub !== undefined) {
    const next = sub.nextSub;
    unlink(sub, sub.sub);
    sub = next;
  }
  const scope = cell.scope;
  if (scope !== undefined) {
    disposeOwner(scope);
    cell.scope = undefined;
    // Only an effect's body is released: it is dead for good, and it may retain
    // a large closure. A computed keeps its body so that a late read of a
    // disposed computed still answers instead of crashing.
    cell.fn = undefined;
  }
}

/** Walks the owner tree for an error boundary; otherwise reports globally. */
export function handleError(error: unknown, owner: Owner | null): void {
  if (error instanceof FirsthandCycleError) {
    // A cycle is fatal and belongs to the write that caused it. Letting a
    // boundary swallow it would hide an unbounded loop behind a fallback UI.
    throw error;
  }
  let scope = owner;
  while (scope !== null) {
    const handler = scope.handler;
    if (handler !== null) {
      try {
        handler(error);
      } catch (nested) {
        handleError(nested, scope.parent);
      }
      return;
    }
    scope = scope.parent;
  }
  reportUncaught(error);
}

// ---------------------------------------------------------------------------
// Internal accessors used by the public layer
// ---------------------------------------------------------------------------

export function getOwner(): Owner | null {
  if (deferred) {
    currentOwner = createOwner(deferredParent);
    deferred = false;
  }
  return currentOwner;
}

export function setOwner(owner: Owner | null): Owner | null {
  const previous = getOwner();
  currentOwner = owner;
  deferred = false;
  return previous;
}

/**
 * Puts off creating a scope until something needs one.
 *
 * A scope exists so that what a component makes can be taken apart again. A
 * component that makes nothing — no signal, no effect, no context, no cleanup
 * — has nothing to take apart, and on a server most of them are exactly that:
 * a function that reads its props and returns markup. Creating an owner for
 * each of them, linking it into its parent and walking the lot on disposal
 * measured at a sixth of a server render.
 *
 * So the scope is described rather than created. The first thing that asks for
 * one gets one, with the right parent; a component that never asks costs
 * nothing at all.
 *
 * Returns the owner to hand back to `restoreOwner`. The parent is made here
 * rather than deferred in turn, which is what makes that one value enough to
 * restore from — and is no loss, because a component that has children is a
 * component that has a scope.
 */
export function deferOwner(): Owner | null {
  const parent = getOwner();
  deferredParent = parent;
  deferred = true;
  currentOwner = null;
  return parent;
}

/** Ends a `deferOwner`, whether or not the scope was ever made. */
export function restoreOwner(previous: Owner | null): void {
  currentOwner = previous;
  deferred = false;
  deferredParent = null;
}

/** Registers a cell with the current scope so disposal unlinks it. */
export function own(cell: Cell): void {
  const owner = getOwner();
  if (owner !== null) {
    (owner.cells ??= []).push(cell);
  }
}

export function createEffectScope(cell: Cell): Owner {
  const scope = createOwner(getOwner());
  cell.scope = scope;
  return scope;
}

export function runEffectNow(cell: Cell): void {
  runEffect(cell);
}

/**
 * Retires an effect that took no dependencies on its first run.
 *
 * Such an effect can never be invalidated, so keeping it would cost one live
 * object per static expression in every template. Its scope is left attached to
 * the parent owner, because whatever the run created there must still be
 * cleaned up with the parent.
 */
export function releaseEffect(cell: Cell): void {
  cell.flags |= DISPOSED;
  cell.fn = undefined;
  // `createEffect` asked for the scope a moment ago, so this is a read.
  const owner = getOwner();
  if (owner !== null) {
    const cells = owner.cells as Cell[];
    // `createEffect` pushed it last, so this is O(1) in the only case that
    // reaches here.
    cells.pop();
  }
}

export function defaultEquals<T>(
  equals: ((a: T, b: T) => boolean) | false | undefined,
): (a: unknown, b: unknown) => boolean {
  if (equals === undefined) {
    return is;
  }
  if (equals === false) {
    return never;
  }
  return equals as (a: unknown, b: unknown) => boolean;
}

// ---------------------------------------------------------------------------
// Batching and tracking control
// ---------------------------------------------------------------------------

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) {
      flush();
    }
  }
}

/**
 * Reads once, on purpose.
 *
 * The starting value of an editable field, or a decision about what to build:
 * both are reads that should not follow their source. `snapshot` says so, which
 * is what keeps strict reactivity from reporting them — and what tells a reader
 * that the frozen value is the intent rather than an oversight.
 *
 * ```ts
 * const draft = signal(snapshot(() => props.initial));
 * ```
 */
export function snapshot<T>(read: () => T): T {
  devEnterSnapshot();
  try {
    return untrack(read);
  } finally {
    devExitSnapshot();
  }
}

export function untrack<T>(fn: () => T): T {
  const previous = activeSub;
  activeSub = undefined;
  try {
    return fn();
  } finally {
    activeSub = previous;
  }
}
