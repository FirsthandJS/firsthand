/**
 * The whole Firsthand adapter for Storybook: fifteen lines.
 *
 * Storybook's HTML renderer asks a story for an element and puts it on the
 * page. Firsthand builds elements, so a story is `firsthand(() => <Counter />)` —
 * there is no adapter package, no `@storybook/firsthand`, and nothing to keep in
 * step with Storybook's renderer API.
 *
 * The only thing worth doing carefully is disposal: `render` returns a
 * disposer, and a story that is replaced must run it, or its effects outlive
 * the canvas. Hosts that have left the document are disposed on the next
 * render, which needs no Storybook API at all.
 */
import { render, type View } from '@firsthandjs/dom';
import type { Dispose } from '@firsthandjs/dom';

const live = new Map<HTMLElement, Dispose>();

export function firsthand(view: () => View): HTMLElement {
  for (const [host, dispose] of live) {
    if (!host.isConnected) {
      dispose();
      live.delete(host);
    }
  }
  const host = document.createElement('div');
  live.set(host, render(view, host));
  return host;
}
