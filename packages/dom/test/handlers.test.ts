/**
 * Events, props, portals and the array a keyed list hands over.
 *
 * The other half of the part protocol: `parts.test.ts` covers templates,
 * children and reconciliation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@firsthandjs/core';
import { applyChild, FLAT } from '@/insert.js';
import { on, off, resetDelegation } from '@/events.js';
import { applyProp, mergeProps, spread } from '@/props.js';
import { portal } from '@/portal.js';
import { render } from '@/render.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  resetDelegation();
});

describe('events', () => {
  it('delegates one document listener per type', () => {
    const clicks: string[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', () => clicks.push('outer'));
    on(inner, 'click', () => clicks.push('inner'));
    inner.click();
    expect(clicks).toEqual(['inner', 'outer']);
  });

  it('honours stopPropagation', () => {
    const clicks: string[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', () => clicks.push('outer'));
    on(inner, 'click', (event) => {
      event.stopPropagation();
      clicks.push('inner');
    });
    inner.click();
    expect(clicks).toEqual(['inner']);
  });

  it('reports the current target per step', () => {
    const targets: unknown[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', (event) => targets.push(event.currentTarget));
    on(inner, 'click', (event) => targets.push(event.currentTarget));
    inner.click();
    expect(targets).toEqual([inner, outer]);
  });

  it('attaches non-delegated types directly', () => {
    const seen = vi.fn();
    const node = document.createElement('div');
    host.appendChild(node);
    on(node, 'custom-thing', seen);
    node.dispatchEvent(new Event('custom-thing'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('supports the native, once and capture escape hatches', () => {
    const native = vi.fn();
    const once = vi.fn();
    const node = document.createElement('button');
    host.appendChild(node);
    on(node, 'click', native, true);
    on(node, 'click', once, { once: true });
    node.click();
    node.click();
    expect(native).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('removes a delegated handler', () => {
    const seen = vi.fn();
    const node = document.createElement('button');
    host.appendChild(node);
    on(node, 'click', seen);
    off(node, 'click');
    node.click();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('generic prop application', () => {
  it('handles class, style, ref, prop:, attr: and events', () => {
    const node = document.createElement('input');
    host.appendChild(node);
    let captured: Element | undefined;
    applyProp(node, 'ref', (element: Element) => {
      captured = element;
    });
    applyProp(node, 'class', 'a');
    applyProp(node, 'class', { a: false, b: true });
    applyProp(node, 'style', 'color: red');
    applyProp(node, 'style', { marginTop: '3px' });
    applyProp(node, 'prop:value', 'typed');
    applyProp(node, 'attr:data-x', 'y');
    applyProp(node, 'title', 'hello');
    applyProp(node, 'aria-label', 'label');
    const clicked = vi.fn();
    applyProp(node, 'onClick', clicked);
    node.click();

    expect(captured).toBe(node);
    expect(node.classList.contains('b')).toBe(true);
    expect(node.style.marginTop).toBe('3px');
    expect(node.value).toBe('typed');
    expect(node.getAttribute('data-x')).toBe('y');
    expect(node.title).toBe('hello');
    expect(node.getAttribute('aria-label')).toBe('label');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('routes capture and native event modifiers', () => {
    const node = document.createElement('button');
    host.appendChild(node);
    const native = vi.fn();
    const captured = vi.fn();
    applyProp(node, 'onClick:native', native);
    applyProp(node, 'onClick:capture', captured);
    node.click();
    expect(native).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('takes a literal event name after `on:`, for custom elements', () => {
    const node = document.createElement('div');
    host.appendChild(node);
    const changed = vi.fn();
    const captured = vi.fn();
    // What a web-component library dispatches: a name no casing of an
    // identifier can produce.
    applyProp(node, 'on:sl-change', changed);
    applyProp(node, 'on:value-changed:capture', captured);

    node.dispatchEvent(new CustomEvent('sl-change', { bubbles: true }));
    node.dispatchEvent(new CustomEvent('value-changed', { bubbles: true }));

    expect(changed).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledTimes(1);
    // And the camel-case form still lowercases, as every DOM event needs.
    applyProp(node, 'onSlChange', changed);
    node.dispatchEvent(new CustomEvent('slchange', { bubbles: true }));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('spreads a props object, skipping children', () => {
    const node = document.createElement('div');
    host.appendChild(node);
    spread(node, { title: 'spread', children: 'ignored' });
    expect(node.title).toBe('spread');
    expect(node.textContent).toBe('');
  });

  it('merges prop sources without flattening accessors', () => {
    const value = signal('a');
    const merged = mergeProps(
      {
        get live() {
          return value.value;
        },
      },
      { fixed: 1 },
    );
    expect(merged['live']).toBe('a');
    value.value = 'b';
    expect(merged['live']).toBe('b');
    expect(merged['fixed']).toBe(1);
  });
});

describe('portal', () => {
  it('moves primitives and arrays, and cleans up on disposal', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);
    const dispose = render(() => {
      portal(['text', null, false, document.createElement('b')], target);
      return 'local';
    }, host);
    expect(target.textContent).toBe('text');
    expect(target.querySelector('b')).not.toBeNull();
    expect(host.textContent).toBe('local');
    dispose();
    expect(target.childNodes).toHaveLength(0);
  });

  it('tolerates content that was already removed', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);
    const dispose = render(() => portal(document.createElement('b'), target), host);
    target.innerHTML = '';
    expect(() => dispose()).not.toThrow();
  });
});

describe('an array a keyed list produced', () => {
  it('is placed as it stands, rather than walked again', () => {
    // The list has already done the walk: it has the nodes, it made the array,
    // and nobody else can reach it. `applyChild` handing the same array back
    // is how that is visible from here — an ordinary array is copied into a
    // new one, because it may hold nested arrays, thunks or text.
    const parent = document.createElement('div');
    const rows = Object.assign([document.createElement('p'), document.createElement('p')], {
      [FLAT]: true,
    });
    expect(applyChild(parent, null, null, rows)).toBe(rows);
    expect(parent.childNodes).toHaveLength(2);

    const ordinary = [document.createElement('b')];
    expect(applyChild(parent, null, rows, ordinary)).not.toBe(ordinary);
    expect(parent.childNodes).toHaveLength(1);
  });

  it('empties the slot when it is empty', () => {
    const parent = document.createElement('div');
    parent.append(document.createElement('p'), document.createElement('p'));
    const before = [...parent.childNodes];
    const empty = Object.assign([] as Node[], { [FLAT]: true });
    expect(applyChild(parent, null, before, empty)).toBe(null);
    expect(parent.childNodes).toHaveLength(0);
  });
});
