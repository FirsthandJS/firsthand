/**
 * Putting nodes where they belong, and taking them away again.
 *
 * The four calls every child position eventually makes, with the measured
 * reasons each one is shaped the way it is. Nothing here knows what a part is
 * or what a run is: it is given a slot's current contents and a node, and it
 * performs the mutation.
 */

/** What a child part currently owns in the DOM. */
export type ChildSlot = Node | Node[] | null;

export const TEXT_NODE = 3;

export function isNode(value: object): value is Node {
  return typeof (value as Node).nodeType === 'number';
}

/**
 * Removes a node from wherever it currently is.
 *
 * Usually that is `parent`, but a node can legitimately have been moved — an
 * element host relocated in the document, for instance — and disposal must
 * still clean up rather than throw.
 */
export function detach(node: Node): void {
  const owner = node.parentNode;
  if (owner !== null) {
    owner.removeChild(node);
  }
}

/**
 * Empties a child slot that is everything its parent has.
 *
 * Removing ten thousand rows one at a time is ten thousand mutations, each one
 * a chance for the engine to do bookkeeping it is about to throw away. When
 * the slot *is* the parent's content — no marker after it, nothing beside it —
 * the platform has one call that says so, and it is what clearing a table
 * actually costs: `removeChild` was 85 % of that scenario before this.
 *
 * Falls back to removing them one by one whenever the slot is anything less
 * than the whole, including when a node has been moved out from under it.
 */
export function clearIn(parent: Node, marker: Node | null, current: ChildSlot): null {
  if (
    marker === null &&
    Array.isArray(current) &&
    current.length > 1 &&
    parent.childNodes.length === current.length
  ) {
    (parent as Element).textContent = '';
    return null;
  }
  return clear(current);
}

export function clear(current: ChildSlot): null {
  if (current !== null) {
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        detach(current[i] as Node);
      }
    } else {
      detach(current);
    }
  }
  return null;
}

export function single(parent: Node, marker: Node | null, current: ChildSlot, node: Node): Node {
  if (current === node) {
    return node;
  }
  if (current !== null && !Array.isArray(current)) {
    parent.replaceChild(node, current);
    return node;
  }
  clear(current);
  parent.insertBefore(node, marker);
  return node;
}
