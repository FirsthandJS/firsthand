/**
 * `@firsthandjs/deep` — reactivity that follows an object all the way down.
 *
 * A `signal` holds one value and notifies when that value is replaced. That is
 * the right shape for most state, and it is deliberately shallow: writing
 * `state.value.user.name = 'Ada'` mutates the object the signal already holds,
 * so the signal never sees a write and nothing updates.
 *
 * `deepSignal` is the other shape, the one Vue calls `reactive()`. It hands
 * back a proxy of your object where every read is tracked and every write
 * notifies — at any depth, through arrays, without `.value` anywhere:
 *
 * ```ts
 * const state = deepSignal({ user: { name: 'Ada' }, todos: [] as string[] });
 *
 * effect(() => console.log(state.user.name)); // tracks exactly that property
 * state.user.name = 'Grace';                  // and only that effect re-runs
 * state.todos.push('write the docs');         // arrays included
 * ```
 *
 * **Nothing about `signal` changes.** This is built on top of it: each property
 * that is read gets a version cell, created lazily, and a write bumps it. The
 * reactive graph, the scheduler and the owner tree are the ones you already
 * have, so a deep read inside a `computed`, an `effect` or a DOM binding works
 * exactly as a signal read does.
 *
 * **What it costs.** A proxy per object reached, a `Map` of version cells per
 * object, and a trap on every property access. A signal read is a property read
 * on one object; a deep read is a trap plus a cell read. Use it for state whose
 * shape is the point — a form, a document, a settings tree — and use `signal`
 * for the rest.
 */
import { batch, signal, type Signal } from '@firsthandjs/core';
import { devLabelProperty, devRemember } from './dev.js';

/**
 * What may be made deeply reactive: an object or an array.
 *
 * Deliberately not `T extends object`. A function, a `Date`, a `Map`, a
 * `Promise` and a class instance all satisfy `object`, and proxying them
 * silently breaks them in ways that only show up at runtime — a `Map` reads its
 * internal slots through `this`, which a proxy is not. Restricting the type
 * makes that a compile error instead of a bug.
 */
export type Deep = Record<PropertyKey, unknown> | unknown[];

/** Identifies a proxy, and gets back what it wraps. */
const RAW: unique symbol = Symbol.for('firsthand.deep.raw');

/** One proxy per raw object, so identity is stable across reads. */
const proxies = new WeakMap<object, object>();

/**
 * Version cells, one per object and property that has been read.
 *
 * A cell holds a counter rather than the value: the value lives on the raw
 * object, where it is one property read away, and duplicating it into a cell
 * would mean keeping two copies in step. The counter exists only to be
 * subscribed to.
 */
const versions = new WeakMap<object, Map<PropertyKey, Signal<number>>>();

/** Stands for "which keys exist" — what `Object.keys` and `for…in` depend on. */
const KEYS: unique symbol = Symbol.for('firsthand.deep.keys');

function versionOf(target: object, key: PropertyKey): Signal<number> {
  let table = versions.get(target);
  if (table === undefined) {
    table = new Map();
    versions.set(target, table);
  }
  let cell = table.get(key);
  if (cell === undefined) {
    cell = signal(0);
    devLabelProperty(cell, target, key);
    table.set(key, cell);
  }
  return cell;
}

/** Subscribes the current scope to one property of one object. */
function track(target: object, key: PropertyKey): void {
  // Reading the cell is the subscription; the number itself is not used.
  versionOf(target, key).value;
}

/**
 * Notifies the readers of one property.
 *
 * A cell that does not exist yet has no readers, so nothing is created here:
 * writing to a property nobody has read is free.
 */
function trigger(target: object, key: PropertyKey): void {
  const cell = versions.get(target)?.get(key);
  if (cell !== undefined) {
    cell.value++;
  }
}

/** Only plain objects and arrays are followed; everything else is handed back. */
function reactiveKind(value: unknown): value is Deep {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The array methods that mutate.
 *
 * `push` writes an index and then `length`, so an unbatched call would flush
 * twice for one logical change. Running the method inside `batch` makes it one
 * update, which is what the caller wrote.
 */
const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

const handler: ProxyHandler<Deep> = {
  get(target, key, receiver) {
    if (key === RAW) {
      return target;
    }
    const value: unknown = Reflect.get(target, key, receiver);
    if (typeof key === 'symbol') {
      // Symbols are the language's own protocol — `Symbol.iterator`,
      // `Symbol.toPrimitive`. Tracking them would subscribe a component to
      // spreading the object, which is not what anybody means.
      return value;
    }
    if (Array.isArray(target) && typeof value === 'function' && MUTATORS.has(key)) {
      return function mutate(this: unknown, ...args: unknown[]): unknown {
        return batch(() => (value as (...rest: unknown[]) => unknown).apply(receiver, args));
      };
    }
    track(target, key);
    // Nested objects are wrapped on the way out, lazily: an object nobody
    // reaches is never proxied.
    if (!reactiveKind(value)) {
      return value;
    }
    // Devtools learn the path here and nowhere else: this is the one moment
    // the child and the key that reached it are both in hand.
    devRemember(target, key, value);
    return deepSignal(value);
  },

  set(target, key, next, receiver) {
    const array = Array.isArray(target);
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const previous: unknown = Reflect.get(target, key, receiver);
    const lengthBefore = array ? target.length : 0;
    // A proxy assigned back into the tree is stored as its raw object, so the
    // tree holds one representation and `raw` returns something clean.
    const value: unknown = raw(next);
    if (!Reflect.set(target, key, value, receiver)) {
      return false;
    }
    if (!had) {
      // A new key changes what `Object.keys` answers.
      trigger(target, KEYS);
      trigger(target, key);
    } else if (!Object.is(previous, value)) {
      trigger(target, key);
    }
    // `length` is compared rather than assumed. Writing an index updates it
    // implicitly, which makes the explicit `length` write that `push` performs
    // a no-op — so length readers would never hear about a push if this
    // watched the assignment instead of the result.
    if (array && key !== 'length' && target.length !== lengthBefore) {
      trigger(target, 'length');
    }
    return true;
  },

  deleteProperty(target, key) {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const deleted = Reflect.deleteProperty(target, key);
    if (deleted && had) {
      trigger(target, key);
      trigger(target, KEYS);
    }
    return deleted;
  },

  has(target, key) {
    if (typeof key !== 'symbol') {
      track(target, key);
    }
    return Reflect.has(target, key);
  },

  ownKeys(target) {
    // `Object.keys`, `for…in` and spreading all arrive here.
    track(target, Array.isArray(target) ? 'length' : KEYS);
    return Reflect.ownKeys(target);
  },
};

/**
 * Makes an object or array deeply reactive.
 *
 * Returns a proxy with the same shape as what you passed: read it, write it,
 * spread it, iterate it. Reads inside an `effect`, a `computed` or a DOM
 * binding subscribe to exactly the properties they touched; writes notify
 * exactly those readers.
 *
 * Calling it twice with the same object returns the same proxy, and calling it
 * on a proxy returns that proxy, so identity is stable and `===` means what it
 * looks like.
 */
export function deepSignal<T extends Deep>(value: T): T {
  const target = raw(value);
  const existing = proxies.get(target);
  if (existing !== undefined) {
    return existing as T;
  }
  const created = new Proxy(target, handler) as T;
  proxies.set(target, created);
  return created;
}

/**
 * The object a deep proxy wraps, or the value itself if it is not one.
 *
 * For handing state to something that must not be tracked — a structured
 * clone, a `fetch` body, a library that stores what it is given.
 */
export function raw<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const inner: unknown = (value as { [RAW]?: unknown })[RAW];
  return inner === undefined ? value : (inner as T);
}

/** Whether a value is a proxy this package created. */
export function isDeep(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { [RAW]?: unknown })[RAW] !== undefined
  );
}
