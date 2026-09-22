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
import { devWarn } from './dev.js';
import { discard } from './insert.js';

type Row<T> = {
  owner: Owner;
  item: Signal<T>;
  index: Signal<number>;
  nodes: Node[];
};

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

  return () => {
    const items = each();
    const next = new Map<unknown, Row<T>>();
    const nodes: Node[] = [];
    batch(() => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as T;
        const key = untrack(() => keyOf(item, i));
        if (next.has(key)) {
          devWarn(
            `Duplicate list key ${String(key)}. Keys must be unique, or rows will be dropped.`,
          );
          continue;
        }
        let row = rows.get(key);
        if (row === undefined) {
          row = createRow(host, item, i, render);
        } else {
          rows.delete(key);
          row.item.value = item;
          row.index.value = i;
        }
        next.set(key, row);
        for (let n = 0; n < row.nodes.length; n++) {
          nodes.push(row.nodes[n] as Node);
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
    });
    rows = next;
    return nodes;
  };
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
  let result: unknown;
  try {
    result = untrack(() => render(itemCell, indexCell));
    setOwner(previous);
  } catch (error) {
    setOwner(previous);
    throw error;
  }
  const nodes: Node[] = [];
  collect(result, nodes);
  return { owner, item: itemCell, index: indexCell, nodes };
}

function collect(value: unknown, out: Node[]): void {
  if (value == null || typeof value === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collect(value[i], out);
    }
    return;
  }
  if (typeof value === 'object' && typeof (value as Node).nodeType === 'number') {
    out.push(value as Node);
    return;
  }
  out.push(document.createTextNode(String(value)));
}
