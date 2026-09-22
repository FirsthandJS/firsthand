/**
 * What to call a cell.
 *
 * Its own module because both halves need it and neither should import the
 * other: the hook names a cell as it records an update, and the query API names
 * it again when somebody asks what the graph looks like.
 */

import { MUTABLE, recorded } from './recorded.js';

import type { CellLike, NodeKind } from './types.js';

/** A readable name for a cell, whatever devtools managed to learn about it. */
export function nameOf(cell: CellLike): string {
  const part = recorded.parts.get(cell);
  if (part !== undefined) {
    const node = part.node as { tagName?: string; nodeName?: string };
    const tag = (node.tagName ?? node.nodeName ?? 'node').toLowerCase();
    return `${tag}.${part.property}`;
  }
  const label = recorded.labels.get(cell);
  if (label === undefined) {
    return (cell.flags & MUTABLE) === 0 ? 'signal' : 'computed';
  }
  return label.name;
}

export function kindOf(cell: CellLike): NodeKind {
  if (recorded.parts.has(cell)) {
    return 'part';
  }
  return recorded.labels.get(cell)?.kind ?? ((cell.flags & MUTABLE) === 0 ? 'signal' : 'computed');
}
