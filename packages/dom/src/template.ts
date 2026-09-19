/**
 * Static markup is parsed once into a `<template>` and cloned per instance
 * (ADR-0009). The compiler emits one `template()` call per distinct markup
 * shape at module scope; parsing is deferred to the first instance, so a module
 * that is imported but never rendered costs nothing.
 */

export type TemplateFactory = () => Node;

export function template(html: string, isFragment = false): TemplateFactory {
  let source: Node | undefined;
  return () => {
    if (source === undefined) {
      const element = document.createElement('template');
      element.innerHTML = html;
      source = isFragment ? element.content : (element.content.firstChild as Node);
    }
    return source.cloneNode(true);
  };
}

/**
 * Descends to a node by a compile-time-known chain of child indices.
 *
 * This is how dynamic positions are located: no `querySelector`, no marker
 * attributes, no scanning. The compiler knows the shape of the template, so it
 * emits the path.
 */
export function path(root: Node, ...indices: readonly number[]): Node {
  let node = root;
  for (let i = 0; i < indices.length; i++) {
    let child = node.firstChild as Node;
    for (let step = indices[i] as number; step > 0; step--) {
      child = child.nextSibling as Node;
    }
    node = child;
  }
  return node;
}
