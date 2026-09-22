/**
 * Static markup is parsed once into a `<template>` and cloned per instance
 * (ADR-0009). The compiler emits one `template()` call per distinct markup
 * shape at module scope; parsing is deferred to the first instance, so a module
 * that is imported but never rendered costs nothing.
 */

import { devHydrationMismatch } from './dev.js';
import { hydration } from './claim.js';

export type TemplateFactory = () => Node;

export function template(html: string, isFragment = false): TemplateFactory {
  let source: Node | undefined;
  let expected: string | undefined;
  return () => {
    const claimer = hydration.current;
    if (claimer !== null) {
      // The node is already on the page. Adopting it is the whole point: no
      // parse, no clone, no insertion — and the markup is never even read, so
      // a hydrated template costs less than a rendered one.
      //
      // What is read is one name. A node is adopted only if it is the element
      // this template makes, which is the difference between hydrating a page
      // and believing one: a branch the server took and the browser did not
      // would otherwise be kept, with the markup of one and the behaviour of
      // the other.
      expected ??= claimer.tag(html);
      const claimed = claimer.adopt(expected);
      if (claimed !== null) {
        devHydrationMismatch(claimed as Element, html);
        return claimed;
      }
      // Nothing to adopt, or not the right thing: the node is built the
      // ordinary way, and whoever asked for it puts it where it belongs.
    }
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
