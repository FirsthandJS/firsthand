/**
 * The questions devtools answer, and the only things a panel needs.
 *
 * The reactive graph is not something this package records. It is already
 * there, because propagation and disposal need it: every cell carries its
 * dependencies and its subscribers as linked lists, and every owner carries its
 * children and its cells. These functions read that structure and put names on
 * it, using what `record.ts` wrote down.
 *
 * `panel.ts` imports from here rather than from the entry module, which is what
 * keeps the entry module free to load the panel on demand.
 */

import { kindOf, nameOf } from './names.js';

import { liveRoots, recorded } from './recorded.js';

import type { CellLike, GraphNode, OwnerLike, QueryEvent, Update } from './types.js';

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
  const effects = recorded.writers.get(node);
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
  return found.map((root) => draw(path(root)).join('\n   ↓\n')).join('\n\n');
}

/**
 * The longest path through a node's dependencies, sources first.
 *
 * One path rather than the whole tree, because a chain is a story: it is what
 * `chain` prints and what the panel draws as boxes. `inspect` has the shape
 * for anything that wants all of it.
 */
export function path(node: GraphNode): GraphNode[] {
  let longest: GraphNode[] = [];
  for (const dependency of node.dependencies) {
    const deeper = path(dependency);
    if (deeper.length > longest.length) {
      longest = deeper;
    }
  }
  return [...longest, node];
}

function draw(nodes: GraphNode[]): string[] {
  return nodes.map((node) => (node.kind === 'computed' ? `computed(${node.name})` : node.name));
}

/**
 * Why an effect last ran: the dependency whose change scheduled it.
 *
 * The graph does not keep this — nothing needs it once the flush is over — so
 * it is the one fact devtools record rather than read.
 */
export function causeOf(node: Node): string | null {
  const effects = recorded.writers.get(node);
  if (effects === undefined) {
    return null;
  }
  for (const effect of effects) {
    const dep = recorded.causes.get(effect);
    if (dep !== undefined) {
      return nameOf(dep as CellLike);
    }
  }
  return null;
}

/**
 * What the resources have done, oldest first.
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
  return [...recorded.cacheLog];
}

/**
 * The component stack a DOM node's part lives in, outermost first.
 *
 * The owner tree already has the shape — a component's scope is the parent of
 * everything its setup created — so this is a walk, not a recording. What the
 * DOM layer contributes is the name, which only it knows and only at the
 * moment an instance is created.
 *
 * ```ts
 * stack(button); // ['App', 'OrderPage', 'SaveButton']
 * ```
 */
export function stack(node: Node): string[] {
  const effects = recorded.writers.get(node);
  if (effects === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const effect of effects) {
    const found = componentsAbove((effect as CellLike).scope ?? null);
    if (found.length > names.length) {
      names.length = 0;
      names.push(...found);
    }
  }
  return names;
}

/** The named scopes from a scope up to the root, outermost first. */
function componentsAbove(scope: OwnerLike | null): string[] {
  const found: string[] = [];
  for (let owner = scope; owner !== null; owner = owner.parent) {
    const name = recorded.components.get(owner);
    if (name !== undefined) {
      found.unshift(name);
    }
  }
  return found;
}

/**
 * Every update, oldest first: what was written, and what ran because of it.
 *
 * The graph answers "what depends on this". This answers "what happened", in
 * order and with a time — which is the question when something updated and
 * nobody expected it to.
 *
 * ```ts
 * timeline();            // everything
 * timeline(button);      // only the updates that ran this node's part
 * ```
 *
 * The last 100 updates, so that a page left open overnight is still a
 * debugging tool rather than a leak.
 */
export function timeline(node?: Node): Update[] {
  if (node === undefined) {
    return recorded.updates.map((entry) => entry.update);
  }
  const effects = recorded.writers.get(node);
  if (effects === undefined) {
    return [];
  }
  return recorded.updates
    .filter((entry) => entry.effects.some((effect) => effects.has(effect)))
    .map((entry) => entry.update);
}
