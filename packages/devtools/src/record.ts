/**
 * The hook the core calls, and the only thing in this package that writes.
 *
 * Nothing here runs unless `install()` is called, and none of it exists in a
 * production build of the framework: the hooks that feed it live in modules the
 * build replaces with empty functions (ADR-0020).
 *
 * It knows how to record and nothing about how anyone reads it back. That is
 * what lets `queries.ts` sit beside it rather than above it, and it is why the
 * panel can be loaded without loading this.
 */

import type { DevtoolsHook } from '@firsthandjs/core';

import { nameOf } from './names.js';

import { LOG_LIMIT, UPDATE_LIMIT, append, forget, recorded } from './recorded.js';

import type { CellLike, NodeKind, OwnerLike, QueryEvent, Update } from './types.js';

/** The update being collected, while its effects run. */
let current: { update: Update; effects: object[] } | null = null;
let running: object | null = null;
/** Told after each effect run, so the panel can redraw what it is showing. */
let watcher: (() => void) | null = null;
/** The source of the write being flushed, until the next one. */
let lastCause: object | null = null;
let installed: DevtoolsHook | null = null;

/**
 * Frames that are not the application's own.
 *
 * `node_modules` is the one that matters in a real project. A development
 * server pre-bundles dependencies into chunks with names like
 * `chunk-VEDSTG62.js`, which carry no trace of the package they came from — so
 * matching on `@firsthandjs` alone named every signal after a bundler
 * artefact. Application code is never under `node_modules`, and a library
 * creating a signal on someone's behalf is not the answer anyone wants either,
 * so skipping all of it is right twice over.
 *
 * The `packages/<name>/src` form covers this repository's own tests, where the
 * framework is sources on disk. The `src` matters: a test lives under
 * `packages/devtools/test` and must not be skipped.
 */
const FRAMEWORK =
  /@firsthandjs|[\\/]node_modules[\\/]|[\\/]packages[\\/](core|dom|deep|devtools|jsx-runtime|data|router|styled|testing)[\\/]src[\\/]/;

/**
 * The application frames of the current call, nearest first.
 *
 * Captured per write rather than per read: a write is a deliberate act and
 * there are few of them, while reads are the hot path and must never be
 * touched. Bounded to six, because a stack is a hint and not a transcript.
 */
function callers(): string[] {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  const own: string[] = [];
  for (const frame of frames) {
    if (FRAMEWORK.test(frame)) {
      continue;
    }
    const trimmed = frame.trim().replace(/^at\s+/, '');
    if (trimmed !== '') {
      own.push(trimmed);
    }
    if (own.length === 6) {
      break;
    }
  }
  return own;
}

/**
 * The creation site of whatever is being labelled.
 *
 * Used when nothing better is known — a signal the compiler did not name.
 */
function site(): string {
  // A stack is not guaranteed by the language, only by every engine that
  // matters, and a page with nothing but framework frames on it is possible
  // too. Both fall back rather than branch.
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  // The framework's own frames are not an answer: every signal is created
  // inside `signal()`, so reporting that would name them all the same. What is
  // wanted is the first frame that belongs to the application.
  const caller = frames.find((frame) => !FRAMEWORK.test(frame)) ?? 'unknown';
  const location = /\(?([^()\s]+:\d+:\d+)\)?$/.exec(caller.trim());
  if (location === null) {
    return caller.trim();
  }
  // Kept whole, URL and all. The position is in the *compiled* module, and
  // reading it back to the line that was written needs the module it came
  // from — so the URL is the half of it that must not be thrown away. The
  // panel resolves and shortens it where it is shown.
  return location[1] as string;
}

/**
 * Installs the hook, unless one is already installed.
 *
 * Returns whether it did, so the caller knows whether the rest of attaching —
 * the shortcut, the console API — still has to happen.
 */
export function install(): boolean {
  if (installed !== null) {
    return false;
  }
  const hook: DevtoolsHook = {
    attached: true,
    label(target, kind, name) {
      recorded.labels.set(target, { kind: kind as NodeKind, name: name === '' ? site() : name });
    },
    cause: beginUpdate,
    root(owner) {
      recorded.roots.add(new WeakRef(owner as OwnerLike));
    },
    component(owner, name) {
      recorded.components.set(owner, name);
    },
    running: effectRan,
    query(event, key, tags) {
      append(recorded.cacheLog, { event: event as QueryEvent['event'], key, tags }, LOG_LIMIT);
    },
    part: partWrote,
  };
  globalThis.__FIRSTHAND_DEVTOOLS__ = hook;
  installed = hook;
  return true;
}

/**
 * A write begins a new entry.
 *
 * Effects that run before the next write belong to this one — the same pairing
 * `causeOf` uses, kept as a sequence rather than only as a latest.
 */
function beginUpdate(dep: object): void {
  lastCause = dep;
  current = {
    update: {
      at: Math.round(performance.now()),
      source: nameOf(dep as CellLike),
      ran: [],
      stack: callers(),
    },
    effects: [],
  };
  append(recorded.updates, current, UPDATE_LIMIT);
}

/** An effect started, or the last one finished. */
function effectRan(effect: object | null): void {
  running = effect;
  if (effect === null) {
    // An effect has just finished, so what the panel is showing may be out of
    // date. Told rather than polled: a panel that redraws on a timer is either
    // wrong between ticks or busy for no reason.
    watcher?.();
    return;
  }
  // Whatever runs after a write ran because of it. The core reports the write
  // once rather than once per subscriber, so this pairing is what keeps the
  // explanation out of the propagation loop.
  if (lastCause !== null) {
    recorded.causes.set(effect, lastCause);
    current?.update.ran.push(nameOf(effect as CellLike));
    current?.effects.push(effect);
  }
}

/** The effect that is running writes this node's property. */
function partWrote(node: object, property: string): void {
  if (running === null) {
    return;
  }
  recorded.parts.set(running, { node, property });
  let byNode = recorded.writers.get(node);
  if (byNode === undefined) {
    byNode = new Set();
    recorded.writers.set(node, byNode);
  }
  byNode.add(running);
}

/** Stops recording and forgets everything. */
export function uninstall(): void {
  if (installed !== null) {
    installed.attached = false;
  }
  globalThis.__FIRSTHAND_DEVTOOLS__ = undefined;
  installed = null;
  running = null;
  lastCause = null;
  current = null;
  watcher = null;
  forget();
}

/** Who to tell when the graph has settled. The panel is the only caller. */
export function setWatcher(onSettled: (() => void) | null): void {
  watcher = onSettled;
}
