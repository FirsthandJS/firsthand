/**
 * Devtools for Firsthand (ADR-0020).
 *
 * The reactive graph is not something this package records. It is already
 * there, because propagation and disposal need it: every cell carries its
 * dependencies and its subscribers as linked lists, and every owner carries
 * its children and its cells. This package attaches names to those nodes and
 * reads the structure when asked.
 *
 * Nothing here runs unless `attach()` is called, and none of it exists in a
 * production build of the framework: the hooks that feed it live in modules
 * the build replaces with empty functions.
 */
import type { DevtoolsHook } from '@firsthandjs/core';

/** What a node of the graph is. */
export type NodeKind = 'signal' | 'computed' | 'effect' | 'part';

/** Something the query cache did. */
export interface QueryEvent {
  event: 'created' | 'invalidated' | 'dropped';
  /** The cache key: its tags and variables, as the client derived them. */
  key: string;
  /** The tags the entry carries, which is what an invalidation matches on. */
  tags: readonly string[];
}

/** One node of the graph, as devtools describe it. */
export interface GraphNode {
  kind: NodeKind;
  /** `order.status`, `isEditable`, `button.disabled`, or a creation site. */
  name: string;
  /** The value the cell currently holds. */
  value: unknown;
  /** What this node reads. */
  dependencies: GraphNode[];
  /** What reads this node. */
  dependents: GraphNode[];
}

/** Internal shape of a cell, as the core builds it. Read, never written. */
interface CellLike {
  flags: number;
  v: unknown;
  deps?: LinkLike;
  subs?: LinkLike;
}

interface LinkLike {
  dep: CellLike;
  sub: CellLike;
  nextDep?: LinkLike;
  nextSub?: LinkLike;
}

interface OwnerLike {
  head: OwnerLike | null;
  next: OwnerLike | null;
  cells: CellLike[] | null;
}

interface Label {
  kind: NodeKind;
  name: string;
}

const labels = new WeakMap<object, Label>();
/** Which node and property each effect writes, learned while it runs. */
const parts = new WeakMap<object, { node: object; property: string }>();
/** The effect a DOM node is written by, for looking a chain up from the page. */
const writers = new WeakMap<object, Set<object>>();
/** Why each effect last ran. */
const causes = new WeakMap<object, object>();
/** What the query cache has done, newest last. */
const cacheLog: QueryEvent[] = [];
/** Bounded: a long session would otherwise keep every fetch it ever made. */
const LOG_LIMIT = 200;
const roots = new Set<WeakRef<OwnerLike>>();

let running: object | null = null;
/** The source of the write being flushed, until the next one. */
let lastCause: object | null = null;
let installed: DevtoolsHook | null = null;

/** `MUTABLE`, from the core's flags: distinguishes a computed from a signal. */
const MUTABLE = 1 << 0;

/**
 * Frames that belong to the framework rather than to the application.
 *
 * `@firsthandjs/…` covers an installed copy; the `packages/<name>/src` form
 * covers this repository's own tests, where the packages are sources on disk.
 * The `src` matters: a test lives under `packages/devtools/test`, and skipping
 * that would name every signal after a bundler chunk.
 */
const FRAMEWORK =
  /@firsthandjs|[\\/]packages[\\/](core|dom|deep|devtools|jsx-runtime|query|router|styled|testing)[\\/]src[\\/]/;

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
  // The file name and the position, not the whole absolute URL: a panel has a
  // column of these, and `order.ts:12:19` is the part that identifies one.
  const path = location[1] as string;
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * Starts recording.
 *
 * Call it before the application creates anything — an import at the top of
 * the entry module is the usual place — because a cell created earlier has no
 * name to record. It stays in the graph; it is simply labelled by its
 * creation site rather than by what it is called.
 */
export function attach(): void {
  if (installed !== null) {
    return;
  }
  const hook: DevtoolsHook = {
    attached: true,
    label(target, kind, name) {
      labels.set(target, {
        kind: kind as NodeKind,
        name: name === '' ? site() : name,
      });
    },
    cause(dep) {
      lastCause = dep;
    },
    root(owner) {
      roots.add(new WeakRef(owner as OwnerLike));
    },
    running(effect) {
      running = effect;
      // Whatever runs after a write ran because of it. The core reports the
      // write once rather than once per subscriber, so this pairing is what
      // keeps the explanation out of the propagation loop.
      if (effect !== null && lastCause !== null) {
        causes.set(effect, lastCause);
      }
    },
    query(event, key, tags) {
      cacheLog.push({ event: event as QueryEvent['event'], key, tags });
      if (cacheLog.length > LOG_LIMIT) {
        cacheLog.shift();
      }
    },
    part(node, property) {
      if (running === null) {
        return;
      }
      parts.set(running, { node, property });
      let byNode = writers.get(node);
      if (byNode === undefined) {
        byNode = new Set();
        writers.set(node, byNode);
      }
      byNode.add(running);
    },
  };
  globalThis.__FIRSTHAND_DEVTOOLS__ = hook;
  installed = hook;
  // The console cannot import. A bare specifier has no resolver there, and in
  // a bundled application the module is inside the bundle — so the API is put
  // where the console can reach it, spelled to pair with the element the
  // Elements panel has selected:
  //
  //   __FIRSTHAND__.chain($0)
  (globalThis as { __FIRSTHAND__?: Console }).__FIRSTHAND__ = {
    chain,
    inspect,
    causeOf,
    cells,
    queries,
    detach,
    // Loaded when it is opened, not before: the panel is the larger half of
    // this package and most sessions never open it.
    panel: (node?: Node) => {
      void import('./panel.js').then((module) => {
        if (node === undefined) {
          module.open();
        } else {
          module.show(node);
        }
      });
    },
  };
}

/** What `attach()` puts on `globalThis` for the browser console to use. */
export interface Console {
  chain: typeof chain;
  inspect: typeof inspect;
  causeOf: typeof causeOf;
  cells: typeof cells;
  queries: typeof queries;
  detach: typeof detach;
  /** Opens the panel, or shows it for a node you already have. */
  panel: (node?: Node) => void;
}

/** Stops recording and forgets everything. Mostly for tests. */
export function detach(): void {
  if (installed !== null) {
    installed.attached = false;
  }
  globalThis.__FIRSTHAND_DEVTOOLS__ = undefined;
  delete (globalThis as { __FIRSTHAND__?: Console }).__FIRSTHAND__;
  installed = null;
  running = null;
  lastCause = null;
  cacheLog.length = 0;
  roots.clear();
}

/** A readable name for a cell, whatever devtools managed to learn about it. */
function nameOf(cell: CellLike): string {
  const part = parts.get(cell);
  if (part !== undefined) {
    const node = part.node as { tagName?: string; nodeName?: string };
    const tag = (node.tagName ?? node.nodeName ?? 'node').toLowerCase();
    return `${tag}.${part.property}`;
  }
  const label = labels.get(cell);
  if (label === undefined) {
    return (cell.flags & MUTABLE) === 0 ? 'signal' : 'computed';
  }
  return label.name;
}

function kindOf(cell: CellLike): NodeKind {
  if (parts.has(cell)) {
    return 'part';
  }
  return labels.get(cell)?.kind ?? ((cell.flags & MUTABLE) === 0 ? 'signal' : 'computed');
}

/**
 * Describes one cell and, to the given depth, what it reads and what reads it.
 *
 * Depth is bounded rather than exhaustive because a graph in a real
 * application is wide: the question is almost always "what is immediately
 * around this", and an unbounded walk answers a question nobody asked.
 */
function describe(cell: CellLike, up: number, down: number): GraphNode {
  const node: GraphNode = {
    kind: kindOf(cell),
    name: nameOf(cell),
    value: cell.v,
    dependencies: [],
    dependents: [],
  };
  // The depth is what bounds this walk. A visited-set would bound it too, and
  // would also hide the diamond an application actually has — two paths to the
  // same signal is information, not a repetition to suppress.
  if (up > 0) {
    for (let edge = cell.deps; edge !== undefined; edge = edge.nextDep) {
      node.dependencies.push(describe(edge.dep, up - 1, 0));
    }
  }
  if (down > 0) {
    for (let edge = cell.subs; edge !== undefined; edge = edge.nextSub) {
      node.dependents.push(describe(edge.sub, 0, down - 1));
    }
  }
  return node;
}

/** Every live root, with the dead references swept out on the way past. */
function liveRoots(): OwnerLike[] {
  const live: OwnerLike[] = [];
  for (const ref of roots) {
    const owner = ref.deref();
    if (owner === undefined) {
      roots.delete(ref);
    } else {
      live.push(owner);
    }
  }
  return live;
}

function collect(owner: OwnerLike, into: CellLike[]): void {
  if (owner.cells !== null) {
    into.push(...owner.cells);
  }
  for (let child = owner.head; child !== null; child = child.next) {
    collect(child, into);
  }
}

/** Every computed and effect currently alive, in owner order. */
export function cells(): GraphNode[] {
  const found: CellLike[] = [];
  for (const root of liveRoots()) {
    collect(root, found);
  }
  return found.map((cell) => describe(cell, 1, 1));
}

/**
 * What feeds a DOM node, all the way up to the signals.
 *
 * This is the question the panel exists for: the node is on the screen, the
 * value is wrong, and what you want to know is where it came from.
 */
export function inspect(node: Node, depth = 8): GraphNode[] {
  const effects = writers.get(node);
  if (effects === undefined) {
    return [];
  }
  return [...effects].map((effect) => describe(effect as CellLike, depth, 0));
}

/**
 * The chain from a DOM node up to its sources, as text.
 *
 * ```
 * order.status
 *    ↓
 * computed(isEditable)
 *    ↓
 * button.disabled
 * ```
 *
 * Only the deepest path is drawn, because a chain is a story and a tree is
 * not. `inspect` returns the whole shape for anything that wants it.
 */
export function chain(node: Node): string {
  const found = inspect(node);
  if (found.length === 0) {
    return 'Nothing reactive writes this node.';
  }
  return found.map((root) => draw(deepest(root)).join('\n   ↓\n')).join('\n\n');
}

/** The longest path through a node's dependencies, sources first. */
function deepest(node: GraphNode): GraphNode[] {
  let longest: GraphNode[] = [];
  for (const dependency of node.dependencies) {
    const path = deepest(dependency);
    if (path.length > longest.length) {
      longest = path;
    }
  }
  return [...longest, node];
}

function draw(path: GraphNode[]): string[] {
  return path.map((node) => (node.kind === 'computed' ? `computed(${node.name})` : node.name));
}

/**
 * Why an effect last ran: the dependency whose change scheduled it.
 *
 * The graph does not keep this — nothing needs it once the flush is over — so
 * it is the one fact devtools record rather than read.
 */
export function causeOf(node: Node): string | null {
  const effects = writers.get(node);
  if (effects === undefined) {
    return null;
  }
  for (const effect of effects) {
    const dep = causes.get(effect);
    if (dep !== undefined) {
      return nameOf(dep as CellLike);
    }
  }
  return null;
}

/**
 * What the query cache has done, oldest first.
 *
 * The cache is the one part of the framework whose behaviour is not in the
 * reactive graph: a tag match is a decision rather than an edge, and an
 * invalidation that matched nothing looks exactly like one that was never
 * sent. Bounded to the last 200 events, because a long session should not
 * become a memory leak in a debugging tool.
 *
 * ```ts
 * queries().filter((e) => e.event === 'invalidated');
 * ```
 */
export function queries(): QueryEvent[] {
  return [...cacheLog];
}
