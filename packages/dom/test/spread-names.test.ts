/**
 * What a spread may write as an attribute name, in the browser.
 *
 * The companion to the server's `spread-names` suite. A spread is the one
 * place where a runtime object decides the *names* in the markup, and an
 * application that spreads a dictionary it did not write - a row from a
 * database, a query string, a JSON body - would otherwise let whoever wrote
 * that dictionary attach script to the page:
 *
 *     <div {...{ onmouseover: 'alert(1)' }} />
 *
 * The browser used to take that through `setAttribute` and run it. It now
 * refuses, as the server does, so the two agree about what the markup is.
 * A component's own `onClick={handler}` never comes this way: it is attached
 * as a listener several branches earlier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDelegation } from '@/events.js';
import { applyProp } from '@/props.js';

describe('a name a spread would write in the browser', () => {
  let node: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    node = document.createElement('div');
    // In the document, because handlers are delegated to one listener at the
    // root: a node outside it hears nothing, and the listener test would pass
    // for the wrong reason.
    document.body.appendChild(node);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetDelegation();
  });

  it('refuses an inline handler however it is spelled', () => {
    applyProp(node, 'onmouseover', 'alert(1)');
    applyProp(node, 'ONERROR', 'alert(1)');

    expect(node.getAttribute('onmouseover')).toBe(null);
    expect(node.getAttribute('onerror')).toBe(null);
    expect(node.outerHTML).toBe('<div></div>');
  });

  it('says which name it refused, rather than failing in silence', () => {
    applyProp(node, 'onmouseover', 'alert(1)');

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('onmouseover'));
  });

  it('still attaches a handler a component actually wrote', () => {
    const seen = vi.fn();
    applyProp(node, 'onClick', seen);
    node.click();

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still writes the ordinary names an application spreads', () => {
    applyProp(node, 'id', 'seven');
    applyProp(node, 'data-open', 'yes');
    applyProp(node, 'aria-label', 'Close');

    expect(node.outerHTML).toBe('<div id="seven" data-open="yes" aria-label="Close"></div>');
  });
});
