/**
 * Adopting server-rendered markup instead of building it.
 *
 * ```ts
 * import { hydrate } from '@firsthandjs/dom/hydrate';
 *
 * hydrate(() => <App />, document.getElementById('app')!);
 * ```
 *
 * Its own entry point, not part of `@firsthandjs/dom`, for one reason: an
 * application without a server must not carry this. Nothing in the render
 * path imports this module — `template` and `insert` read the holder in
 * `claim.ts`, which stays empty — so a bundle that never imports it never
 * contains it.
 *
 * A hydrating render runs exactly the same compiled code as a fresh one. What
 * changes is where nodes come from: `template()` hands back a node the server
 * already sent rather than a clone, and a dynamic child finds its content in
 * place rather than creating it. Nothing else in the render path knows.
 *
 * The only thing that makes that possible is knowing which nodes belong to
 * which dynamic child, and the server says so: it wraps every dynamic child in
 * `<!--[-->` … marker, where the marker is the same comment the browser's own
 * template has at that position. Two consequences follow, and they are the
 * whole design:
 *
 * - **Navigation still works.** `firstChild.nextSibling` would walk into the
 *   content of a dynamic child, because the content has a length the template
 *   does not. Compiled with `hydratable`, navigation goes through `first` and
 *   `next` instead, which step over a whole region in one move — landing on
 *   the marker, which is the node the template has there.
 * - **Text does not run together.** The parser would read `Hello, ` and a
 *   dynamic `Ada` as one text node. The opening comment sits between them, so
 *   the part gets a text node of its own to write to.
 *
 * The comments are in the server's markup only. A build without SSR emits
 * neither them nor the navigation helpers, and pays nothing at all.
 */

import type { Dispose } from '@firsthandjs/core';
import { hydration, type Claimed, type Filled, type Region } from './claim.js';
import type { View } from './component.js';
import { mount } from './render.js';

const COMMENT_NODE = 8;
const TEXT_NODE = 3;
const OPEN = '[';

let claim: Region | null = null;
let depth = 0;

/** How far each parent's dynamic children have been claimed. */
let cursors: WeakMap<Node, Node | null> = new WeakMap();

/** The opening comments, removed once the whole tree has been adopted. */
let openers: Node[] = [];

/**
 * Regions claimed by one part and handed to another.
 *
 * A child a run keeps is created as a dynamic child with an anchor of its own,
 * and the anchor is not in the server's markup — so the nested `insert` would
 * look for a region that has already been claimed by the run. The run offers
 * it instead, against the anchor it just put in place.
 */
let offers: Map<Node, Claimed> = new Map();

/**
 * Takes over markup a server already sent.
 *
 * The same call as `render`, against the same view, with the same result — a
 * live application and a disposer. What it does not do is build anything that
 * is already there: every element is adopted, every text node is kept, and the
 * only writes are the listeners and the properties markup cannot express.
 *
 * The view has to be the view the server rendered — same props, same state,
 * same answer. Where it is not:
 *
 * - A **dynamic** value that disagrees is written, as it would be on any other
 *   change. The page ends up right; the work hydration saved is spent.
 * - A **different element** is not adopted. The browser builds its own and the
 *   part it belongs to puts it in place of what was sent.
 * - **Static markup** that disagrees is kept as the server wrote it, because
 *   static markup is the markup nothing ever writes again. Development says so
 *   by name; production cannot, and a view that renders two different things
 *   from the same props is a bug this cannot repair.
 */
export function hydrate(view: () => View, container: ParentNode = document.body): Dispose {
  return mount(view, container, (body) => {
    hydrateWith(container, body);
  });
}

/**
 * Runs `body` against server markup already in `container`.
 *
 * Nested calls are counted rather than nested: an island inside an island is
 * one hydration as far as the markup is concerned, and the outer one finishes
 * the sweep.
 */
export function hydrateWith<T>(container: Node, body: () => T): T {
  const outer = claim;
  const previous = depth;
  depth++;
  hydration.current = claimer;
  claim = { node: container.firstChild, end: null };
  try {
    return body();
  } finally {
    claim = outer;
    depth = previous;
    if (depth === 0) {
      hydration.current = null;
      finish();
    }
  }
}

/** Removes the markers that only existed to say where the regions were. */
function finish(): void {
  for (let i = 0; i < openers.length; i++) {
    const node = openers[i] as Node;
    node.parentNode?.removeChild(node);
  }
  openers = [];
  cursors = new WeakMap();
  offers = new Map();
}

/**
 * The next node this region has not handed out yet, if it is a `tag`.
 *
 * A node that is not what was asked for is left where it is rather than
 * consumed: the caller builds its own, and the part it belongs to replaces
 * what is there. Nothing is adopted on a guess.
 */
export function adopt(tag: string): Node | null {
  if (claim === null) {
    return null;
  }
  const node = claim.node;
  if (node === null || node.nodeName !== tag) {
    return null;
  }
  const after = node.nextSibling;
  claim.node = after === claim.end ? null : after;
  return node;
}

/**
 * Finds the region belonging to the next dynamic child of `parent`.
 *
 * Dynamic children are claimed in document order, which is the order the
 * compiled code reaches them in, so this is a cursor and never a search.
 * `marker` is what navigation landed on, and it has to be where the region
 * ends: if it is not, the server and the client disagree about this subtree
 * and the caller renders it from nothing instead.
 */
export function claimRegion(parent: Node, marker: Node | null): Claimed | null {
  if (marker !== null) {
    const offered = offers.get(marker);
    if (offered !== undefined) {
      offers.delete(marker);
      return offered;
    }
  }
  const held = cursors.get(parent);
  const fromTheTop = held === undefined;
  const node = fromTheTop ? parent.firstChild : held;

  let start: Node | null;
  let end: Node | null;
  // The opening marker, if there is one. For the first claim on a parent the
  // search stops at `marker`: a marker found past it belongs to the *next*
  // dynamic child, whose opener the server did emit.
  const stop = fromTheTop ? marker : null;
  let open: Node | null = node;
  while (open !== null && open !== stop && !isOpen(open)) {
    open = open.nextSibling;
  }
  if (open !== null && open !== stop) {
    end = closeOf(open);
    if (marker !== null && marker !== end) {
      return null;
    }
    openers.push(open);
    start = open.nextSibling;
  } else if (fromTheTop) {
    // No opener before the end of this region: the child is the first thing
    // in its element, and the server left the marker out because where the
    // element's children start is where the region starts.
    start = node;
    end = marker;
  } else {
    return null;
  }
  cursors.set(parent, end === null ? null : end.nextSibling);
  if (start === end) {
    start = null;
  }

  const nodes: Node[] = [];
  for (let one = start; one !== null && one !== end; one = one.nextSibling) {
    nodes.push(one);
  }
  const only = nodes.length === 1 ? (nodes[0] as Node) : null;
  return {
    nodes: nodes.length === 0 ? null : (only ?? nodes),
    text: only !== null && only.nodeType === TEXT_NODE ? (only as Text).data : undefined,
    region: { node: start, end },
  };
}

/**
 * Puts an anchor where hydration has got to, and hands back its parent.
 *
 * A keyed list's row that is a view is bound here rather than with the rest,
 * because by then the reconciler would have put the list's anchors where the
 * server's rows are and taken the rows out. The anchor goes in at the point
 * the region has reached, and the row runs there — which adopts the nodes the
 * server sent for it, in row order, because that is the order the markup is
 * in.
 */
export function place(anchor: Node): Node | null {
  const node = claim === null ? null : claim.node;
  const parent = node?.parentNode ?? null;
  parent?.insertBefore(anchor, node);
  return parent;
}

/** Makes `region` the one nodes are adopted from while `body` runs. */
export function within<T>(region: Region, body: () => T): T {
  const outer = claim;
  claim = region;
  try {
    return body();
  } finally {
    claim = outer;
  }
}

function isOpen(node: Node | null): boolean {
  return node !== null && node.nodeType === COMMENT_NODE && node.nodeValue === OPEN;
}

/**
 * The node a region ends before.
 *
 * A region's content can hold regions of its own, so the depth is counted
 * rather than assumed: the first closing comment at depth zero is this
 * region's.
 */
function closeOf(open: Node): Node | null {
  let level = 0;
  for (let node = open.nextSibling; node !== null; node = node.nextSibling) {
    if (node.nodeType !== COMMENT_NODE) {
      continue;
    }
    if (isOpen(node)) {
      level++;
      continue;
    }
    if (level === 0) {
      return node;
    }
    level--;
  }
  return null;
}

function step(node: Node): Node {
  // `node` is typed as a `Node` because that is what the compiled code does
  // with it; at the end of a list of children it is in fact null, and `isOpen`
  // is what decides, so the check reads the node rather than trusting the type.
  return isOpen(node) ? (closeOf(node) as Node) : node;
}

/**
 * The element name a template's markup makes.
 *
 * Read off the markup rather than off a parsed node, because parsing is the
 * cost hydration exists to avoid. A template asks once and remembers.
 */
function tagOf(html: string): string {
  // A template's markup is an element, so there is always a name and always
  // something after it.
  return html.slice(1, html.search(/[\s/>]/)).toUpperCase();
}

/**
 * Gives a child a run keeps the nodes the server sent for it.
 *
 * The anchor goes at the end of the region rather than in place of it, and
 * the region is offered to the `insert` that binds the child next. What was
 * sent then belongs to the child, which is where it came from.
 */
function keep(slot: Filled, parent: Node, anchor: Node, claimed: Claimed): void {
  parent.insertBefore(anchor, claimed.region.end);
  slot.node =
    claimed.nodes === null
      ? anchor
      : [...(Array.isArray(claimed.nodes) ? claimed.nodes : [claimed.nodes]), anchor];
  offers.set(anchor, claimed);
}

/** What `template` and `insert` reach hydration through, once it is here. */
const claimer = { tag: tagOf, adopt, claim: claimRegion, within, keep, step, place };
