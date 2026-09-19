import { onCleanup } from '@firsthandjs/core';

/**
 * Renders `view` into `target`, keeping its logical owner where it was written.
 *
 * `view` is an ordinary expression, so it has already been created under the
 * current scope by the time `portal` sees it. Context, disposal, reactive
 * dependencies, event handling and error ownership all follow the owner tree
 * (ADR-0008), so moving the nodes changes nothing but their physical position.
 *
 * The call contributes nothing at its own position in the tree.
 */
export function portal(view: unknown, target: ParentNode): null {
  const nodes: Node[] = [];
  collectNodes(view, nodes);
  for (let i = 0; i < nodes.length; i++) {
    target.appendChild(nodes[i] as Node);
  }
  onCleanup(() => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as Node;
      node.parentNode?.removeChild(node);
    }
  });
  return null;
}

function collectNodes(value: unknown, out: Node[]): void {
  if (value == null || typeof value === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectNodes(value[i], out);
    }
    return;
  }
  if (typeof value === 'object' && typeof (value as Node).nodeType === 'number') {
    out.push(value as Node);
    return;
  }
  out.push(document.createTextNode(String(value)));
}
