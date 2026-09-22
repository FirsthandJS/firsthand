/**
 * What devtools say a graph is.
 *
 * The public shapes an application or a panel reads, and the internal ones
 * describing what the core actually built. The internal three are read and
 * never written: they are this package's view of another package's private
 * structure, written down here so that the reading is in one place and the
 * assumption is visible.
 */

/** What a node of the graph is. */
export type NodeKind = 'signal' | 'computed' | 'effect' | 'part';

/**
 * One update: a write, and everything that ran because of it.
 *
 * This is the thing the graph cannot answer on its own. The graph says what
 * depends on what; an update says what actually happened, in order, at a time.
 */
export type Update = {
  /** Milliseconds since the page loaded, so entries can be read as a sequence. */
  at: number;
  /** What was written. */
  source: string;
  /** What ran, in the order it ran. */
  ran: string[];
  /**
   * Where the write came from, application frames only.
   *
   * "Which signal changed" is half an answer; the other half is which of your
   * code changed it, and an event handler three files away is exactly the case
   * where the graph cannot help.
   *
   * Kept exactly as the engine gave them, positions in the *compiled* module
   * and all — browsers do not apply source maps to `error.stack`. The panel
   * resolves them through the module's own map before showing them; anything
   * else reading this should do the same.
   */
  stack: string[];
};

/** Something a resource did. */
export type QueryEvent = {
  event: 'created' | 'invalidated' | 'dropped';
  /** The cache key: its tags and variables, as the client derived them. */
  key: string;
  /** The tags the entry carries, which is what an invalidation matches on. */
  tags: readonly string[];
};

/** One node of the graph, as devtools describe it. */
export type GraphNode = {
  kind: NodeKind;
  /** `order.status`, `isEditable`, `button.disabled`, or a creation site. */
  name: string;
  /** The value the cell currently holds. */
  value: unknown;
  /** What this node reads. */
  dependencies: GraphNode[];
  /** What reads this node. */
  dependents: GraphNode[];
};

/** Internal shape of a cell, as the core builds it. Read, never written. */
export type CellLike = {
  flags: number;
  v: unknown;
  deps?: LinkLike;
  subs?: LinkLike;
  /** An effect's own scope, which is where the component stack starts. */
  scope?: OwnerLike;
};

export type LinkLike = {
  dep: CellLike;
  sub: CellLike;
  nextDep?: LinkLike;
  nextSub?: LinkLike;
};

export type OwnerLike = {
  parent: OwnerLike | null;
  head: OwnerLike | null;
  next: OwnerLike | null;
  cells: CellLike[] | null;
};

export type Label = {
  kind: NodeKind;
  name: string;
};
