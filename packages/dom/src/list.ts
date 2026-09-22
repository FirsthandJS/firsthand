import {
  batch,
  createOwner,
  disposeOwner,
  getOwner,
  setOwner,
  signal,
  untrack,
  type Owner,
  type ReadonlyCell,
  type Signal,
} from '@firsthandjs/core';
import { hydration } from './claim.js';
import { devWarn } from './dev.js';
import {
  bindPart,
  discard,
  FLAT,
  isDynamicChild,
  part,
  PENDING,
  type DynamicChild,
} from './insert.js';

type Row<T> = {
  owner: Owner;
  item: Signal<T>;
  index: Signal<number>;
  nodes: Node[];
  /**
   * What the row is made of, in order, when some of it is a part.
   *
   * A row is usually a tree, and then its nodes are all there is to say. A
   * row that holds a part is not fixed: the part writes when what it read
   * changes, and what the row has in the document changes with it. The pieces
   * are kept so that `nodes` can be put together again out of the part that
   * has just changed and the rest of the row, which has not.
   */
  pieces?: Piece[];
};

/** One part of a row, and what it currently has in the document. */
type Slot = { child: DynamicChild; nodes: Node[] };

type Piece = Node | Slot;

/**
 * A keyed list part.
 *
 * `list()` is called while the template is being built, so it captures the
 * component's owner. Rows are created under a dedicated child of that owner and
 * therefore survive the list's own re-evaluation — unlike everything created
 * directly inside the enclosing effect, which is cleared on each run.
 *
 * A row that keeps its key keeps its DOM nodes, its owner and its component
 * state across reorders; only its `item` and `index` cells are updated, so a
 * reorder touches exactly the parts that read the index and nothing else.
 *
 * The returned thunk produces the row nodes in order; `insert` reconciles them
 * by node identity (see `insert.ts` and ADR-0010).
 */
export function list<T>(
  each: () => readonly T[],
  keyOf: (item: T, index: number) => unknown,
  render: (item: ReadonlyCell<T>, index: ReadonlyCell<number>) => unknown,
): () => Node[] {
  const host = createOwner(getOwner());
  let rows = new Map<unknown, Row<T>>();
  /**
   * The array the last pass handed over, and whether any row is a view.
   *
   * A view row's content changes without the list running — it is a part, and
   * a part writes when what it read changes. The array `insert` is holding is
   * what the next reconcile compares against, so it has to say what the rows
   * have now rather than what they had when they were placed. It is rewritten
   * at the start of the next pass, which is the one moment it is read.
   */
  let placed: Node[] | undefined;
  let views = false;

  return () => {
    const items = each();
    if (views && placed !== undefined) {
      // What the rows have now, rather than what they had when they were
      // placed: a view row is a part, and a part writes without the list
      // running. This array is what the next reconcile compares against.
      placed.length = 0;
      for (const row of rows.values()) {
        for (const node of nodesOf(row)) {
          placed.push(node);
        }
      }
    }
    const next = new Map<unknown, Row<T>>();
    // Marked as nodes in order, so the child slot places them without
    // walking them again: this loop is the walk.
    const nodes = [] as Node[] & { [FLAT]?: true; [PENDING]?: (parent: Node) => void };
    nodes[FLAT] = true;
    /**
     * Rows made on this pass that are views rather than trees.
     *
     * Their anchors are in `nodes` and go into the document with everything
     * else; binding waits until they are there, because a part inserts before
     * its anchor and an anchor with no parent has nowhere to insert. Only new
     * rows are here: a row that kept its key kept its part and its content
     * with it, and binding it again would mount a second copy.
     */
    let pending: Row<T>[] | undefined;
    // One `untrack` around the whole pass rather than one per row. Reading a
    // key must not subscribe the list to whatever the key function happens to
    // touch, and that is just as true of ten thousand keys read together as
    // of one read alone — but a closure and a save/restore per row is ten
    // thousand of each, for a list that is redrawn whenever one row changes.
    untrack(() => {
      batch(() => {
        buildRows();
      });
    });
    rows = next;
    placed = nodes;
    if (pending !== undefined) {
      const made = pending;
      nodes[PENDING] = (parent: Node): void => {
        for (const row of made) {
          bindRow(row, parent);
        }
      };
    }
    return nodes;

    function buildRows(): void {
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as T;
        const key = keyOf(item, i);
        if (next.has(key)) {
          devWarn(
            `Duplicate list key ${String(key)}. Keys must be unique, or rows will be dropped.`,
          );
          continue;
        }
        let row = rows.get(key);
        if (row === undefined) {
          row = createRow(host, item, i, render);
          if (row.pieces !== undefined) {
            views = true;
            if (!bindRow(row, null)) {
              pending = pending === undefined ? [row] : [...pending, row];
            }
          }
        } else {
          rows.delete(key);
          row.item.value = item;
          row.index.value = i;
        }
        next.set(key, row);
        // `nodes` on the row, unless the row is a view: then what it has is
        // put together from its parts, which have been writing on their own.
        const found = row.pieces === undefined ? row.nodes : nodesOf(row);
        for (let n = 0; n < found.length; n++) {
          nodes.push(found[n] as Node);
        }
      }
      // Whatever is left in `rows` no longer has a key in the new data. Its
      // nodes are removed by the reconciler, in one go, so the parts inside
      // them are excused from removing theirs one at a time.
      discard(() => {
        for (const row of rows.values()) {
          disposeOwner(row.owner);
        }
      });
    }
  };
}

function isNode(piece: Piece): piece is Node {
  return typeof (piece as Node).nodeType === 'number';
}

/**
 * Binds the parts a row is made of, once there is somewhere to bind them.
 *
 * `into` is the element the list writes to — or nothing at all, while markup
 * a server sent is being adopted. Then each part is placed where hydration
 * has got to and runs there, which adopts the row the server sent, in row
 * order, because that is the order the markup is in. Binding with the rest
 * would be too late: the reconciler would by then have put the list's anchors
 * where the server's rows are and taken the rows out.
 *
 * False when that could not be done — a row past the end of what the server
 * sent. It is built like any other and bound with the rest.
 */
function bindRow<T>(row: Row<T>, into: Node | null): boolean {
  const pieces = row.pieces as Piece[];
  for (const piece of pieces) {
    if (isNode(piece)) {
      continue;
    }
    const parent = into ?? hydration.current?.place(piece.child.anchor) ?? null;
    if (parent === null) {
      return false;
    }
    // What this part has in the document, kept up to date by the part itself:
    // it writes when what it read changes, and a reorder has to move what is
    // there now rather than what was there when the row was made.
    bindPart(piece.child, parent, (found) => {
      piece.nodes = found;
    });
  }
  return true;
}

/** A row's nodes, in order, out of the pieces it is made of. */
function nodesOf<T>(row: Row<T>): Node[] {
  if (row.pieces === undefined) {
    return row.nodes;
  }
  const nodes: Node[] = [];
  for (const piece of row.pieces) {
    if (isNode(piece)) {
      nodes.push(piece);
    } else {
      for (const node of piece.nodes) {
        nodes.push(node);
      }
    }
  }
  return nodes;
}

function createRow<T>(
  host: Owner,
  item: T,
  index: number,
  render: (item: ReadonlyCell<T>, index: ReadonlyCell<number>) => unknown,
): Row<T> {
  const owner = createOwner(host);
  const itemCell = signal(item);
  const indexCell = signal(index);
  const previous = setOwner(owner);
  const pieces: Piece[] = [];
  let parts: boolean;
  try {
    // Collected under the row's own owner, because a row that is a view makes
    // a part here and a part remembers the scope it was written in. Collected
    // after the owner is put back it would belong to whoever happened to be
    // rendering the list, and be disposed with them rather than with the row.
    parts = collect(
      untrack(() => render(itemCell, indexCell)),
      pieces,
    );
  } finally {
    setOwner(previous);
  }
  // A row is usually nodes and nothing else, and then the pieces are the
  // nodes: there is nothing underneath them that can change.
  return parts
    ? { owner, item: itemCell, index: indexCell, nodes: [], pieces }
    : { owner, item: itemCell, index: indexCell, nodes: pieces as Node[] };
}

/**
 * The nodes a row is made of, and the parts it is made of.
 *
 * A row is usually a tree: a component whose setup returned markup hands back
 * an element, and the element is the row. But a setup may return a render
 * function instead, and then the row is a view — something that runs, and runs
 * again when what it read changes. That cannot be collected into a node here;
 * it becomes a part with an anchor, and `insert` binds it once the anchor is
 * in the document.
 */
function collect(value: unknown, out: Piece[]): boolean {
  if (value == null || typeof value === 'boolean') {
    return false;
  }
  if (Array.isArray(value)) {
    let parts = false;
    for (let i = 0; i < value.length; i++) {
      parts = collect(value[i], out) || parts;
    }
    return parts;
  }
  if (typeof value === 'function') {
    const child = part(value as () => unknown);
    out.push({ child, nodes: [child.anchor] });
    return true;
  }
  if (typeof value === 'object') {
    if (isDynamicChild(value)) {
      // A fragment's dynamic child, already a part: it arrives with its anchor
      // and its owner, and needs only to be placed and bound.
      out.push({ child: value, nodes: [value.anchor] });
      return true;
    }
    if (typeof (value as Node).nodeType === 'number') {
      out.push(value as Node);
      return false;
    }
  }
  out.push(document.createTextNode(String(value)));
  return false;
}
