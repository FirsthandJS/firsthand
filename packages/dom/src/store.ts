/**
 * Where a render function keeps what it made (ADR-0026).
 *
 * A render function runs as a whole and has to write into the DOM it already
 * made, so something has to survive between runs. That is a store: one per
 * instance, declared in the setup — which runs once — with a numbered slot per
 * site the compiler found. The index is fixed at compile time, so a site inside
 * an `if` keeps its place whether or not the branch was taken.
 *
 * Everything here is the compiler/runtime protocol. The names and the
 * signatures are what `@firsthandjs/compiler` emits against, and changing one
 * is a protocol change (ARCHITECTURE section 1.1).
 */

import {
  createOwner,
  disposeOwner,
  getOwner,
  runWithOwner,
  setOwner,
  signal,
  type Owner,
  type Signal,
} from '@firsthandjs/core';

import { hydration } from './claim.js';

import { devHandedNewFunction, devRan } from './dev.js';

import { applyChild, insert, isDynamicChild } from './insert.js';

import type { ChildSlot } from './nodes.js';

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
 *
 * Five parameters, against the limit in docs/architecture/code-rules.md §2.
 * The compiler emits this call for every dynamic child of every run, and its
 * arity is the compiler/runtime protocol (ARCHITECTURE section 1.1): an options
 * object here would be one allocation per child per run, on the path a run
 * exists to keep cheap.
 */
// eslint-disable-next-line max-params -- compiler/runtime protocol; see above
export function writeChild(
  store: Store,
  index: number,
  parent: Node,
  marker: Node | null,
  value: unknown,
): void {
  const slot = site(store, index);
  if (slot.node === undefined && hydration.current !== null && adopt(slot, parent, marker, value)) {
    return;
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
 * The first run of a render function, over markup the server already sent.
 *
 * The site starts out owning what is there, so the comparisons in `writeChild`
 * find the value already written and the run writes nothing. Returns whether
 * the write is finished — which it is only for a dynamic child, whose part has
 * been mounted over the region here.
 */
function adopt(slot: Slot, parent: Node, marker: Node | null, value: unknown): boolean {
  const claimed = (hydration.current as NonNullable<typeof hydration.current>).claim(
    parent,
    marker,
  );
  if (claimed === null) {
    return false;
  }
  if (typeof value === 'object' && value !== null && isDynamicChild(value)) {
    // The child's anchor is the client's own — markup has no way to express
    // one — so hydration puts it in place and hands the region to the `insert`
    // below, which is where the child was going to come from anyway.
    slot.last = value;
    (hydration.current as NonNullable<typeof hydration.current>).keep(
      slot,
      parent,
      value.anchor,
      claimed,
    );
    // Read back as what it is; see `PartOwner` in `insert.ts` for why the
    // field is not typed that way.
    runWithOwner(value.owner as unknown as Owner | null, () => {
      insert(parent, value.thunk, value.anchor);
    });
    return true;
  }
  slot.node = claimed.nodes;
  slot.text = claimed.text;
  return false;
}
