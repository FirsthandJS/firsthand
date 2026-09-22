/**
 * The seam hydration is installed through.
 *
 * `template` and `insert` have to be able to adopt nodes a server sent, and
 * an application that has no server must not pay for the machinery that does
 * it. So they do not import it. They read one holder, which is empty until
 * `@firsthandjs/dom/hydrate` fills it — and a bundle that never imports that
 * module never contains the machinery at all, because nothing references it.
 *
 * What is left behind in the ordinary path is one property read and one
 * comparison against `null`, in two places.
 */

/** What a region of server markup turned out to hold. */
export type Claimed = {
  /** The nodes the region holds, as a child slot. */
  nodes: Node | Node[] | null;
  /** The text already there, when the region is one text node. */
  text: string | undefined;
  /** The region itself, for the calls made while a child's first run happens. */
  region: Region;
};

/** Where a claim has got to. */
export type Region = {
  /** The next unclaimed node, or null when the region is used up. */
  node: Node | null;
  /** The node the region stops before. */
  end: Node | null;
};

/**
 * The part of a site hydration fills in.
 *
 * Structural, so that the holder does not have to import `insert.ts` and
 * `insert.ts` does not have to export its record type to reach through it.
 */
export type Filled = {
  node?: Node | Node[] | null;
};

export type Claimer = {
  /** The element name a template's markup makes. */
  tag(html: string): string;
  /** The next node of the current region, if it is a `tag`. */
  adopt(tag: string): Node | null;
  /**
   * Gives a child a run keeps the nodes the run claimed for it.
   *
   * Puts `anchor` at the end of the region and offers the region to whoever
   * claims against that anchor next, which is the child's own `insert`.
   */
  keep(slot: Filled, parent: Node, anchor: Node, claimed: Claimed): void;
  /** The region belonging to the next dynamic child of `parent`. */
  claim(parent: Node, marker: Node | null): Claimed | null;
  /** Makes `region` the one nodes are adopted from while `body` runs. */
  within<T>(region: Region, body: () => T): T;
  /** A step through the template that goes over a whole region at a time. */
  step(node: Node): Node;
  /**
   * Puts `anchor` where hydration has got to, and says what it went into.
   *
   * What a keyed list needs to adopt a row that is a view: the row has
   * nothing of its own until it runs, and it has to run where its markup is,
   * in the order the rows come in — not after the list has decided what goes
   * where. Null when the region is used up, which is a list with more rows
   * than the server sent: those are built.
   */
  place(anchor: Node): Node | null;
};

/**
 * The installed claimer, or nothing.
 *
 * A holder rather than an exported binding, so that every reader sees the
 * same value however the module is bundled.
 */
export const hydration: { current: Claimer | null } = { current: null };

/**
 * The first child of `node`, stepping over a dynamic child's content.
 *
 * Emitted by the compiler in place of `.firstChild` for a build that can
 * hydrate. `.firstChild` would walk into the content of a dynamic child,
 * because the content has a length the template does not.
 */
export function first(node: Node): Node {
  const child = node.firstChild as Node;
  const claimer = hydration.current;
  return claimer === null ? child : claimer.step(child);
}

/** The next sibling of `node`, stepping over a dynamic child's content. */
export function next(node: Node): Node {
  const sibling = node.nextSibling as Node;
  const claimer = hydration.current;
  return claimer === null ? sibling : claimer.step(sibling);
}
