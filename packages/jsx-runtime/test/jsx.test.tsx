/** The runtime JSX path: same protocol, no template hoisting. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@firsthandjs/core';
import { render, type View } from '@firsthandjs/dom';
import { Fragment, jsx, jsxs } from '@/index.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('runtime jsx', () => {
  it('creates elements with static and dynamic props', () => {
    const active = signal(true);
    const node = (
      <div class={() => (active.value ? 'on' : 'off')} title="static">
        hello
      </div>
    ) as HTMLElement;
    host.appendChild(node);
    expect(node.className).toBe('on');
    expect(node.title).toBe('static');
    expect(node.textContent).toBe('hello');
    active.value = false;
    expect(node.className).toBe('off');
  });

  it('creates a childless element without reaching for children', () => {
    const node = jsx('input', { type: 'text', value: 'typed' }) as HTMLInputElement;
    expect(node.tagName).toBe('INPUT');
    expect(node.value).toBe('typed');
    expect(node.childNodes.length).toBe(0);
  });

  it('renders a fragment as an array of children', () => {
    const children = jsx(Fragment, { children: ['a', 'b'] }) as unknown[];
    expect(children).toEqual(['a', 'b']);
    expect(jsx(Fragment, {})).toBeNull();
    expect(jsx(Fragment, { children: 'only' })).toBe('only');
  });

  it('gives a fragment dynamic child its own scope', () => {
    const value = signal('first');
    const many = jsx(Fragment, { children: [() => value.value, 'static'] }) as View;
    const one = jsx(Fragment, { children: () => value.value }) as View;

    const dispose = render(() => many, host);
    expect(host.textContent).toBe('firststatic');
    value.value = 'second';
    expect(host.textContent).toBe('secondstatic');
    dispose();

    // A single dynamic child is wrapped the same way.
    const second = render(() => one, host);
    expect(host.textContent).toBe('second');
    value.value = 'third';
    expect(host.textContent).toBe('third');
    second();
  });

  it('supports a plain function as an element type', () => {
    const Widget = (props: { label: string }): Node => document.createTextNode(props.label);
    const node = jsx(Widget, { label: 'from-function' }) as Node;
    expect(node.textContent).toBe('from-function');
  });

  it('rejects an invalid element type', () => {
    expect(() => jsx(42, {})).toThrow(TypeError);
  });

  it('appends arrays, nodes, primitives and skips empties', () => {
    const node = jsxs('section', {
      children: [
        'text',
        null,
        false,
        undefined,
        [1, document.createElement('b')],
        document.createElement('i'),
      ],
    }) as HTMLElement;
    host.appendChild(node);
    expect(node.textContent).toBe('text1');
    expect(node.querySelectorAll('b')).toHaveLength(1);
    expect(node.querySelectorAll('i')).toHaveLength(1);
  });

  it('keeps a dynamic child updating in place', () => {
    const value = signal('one');
    const node = (
      <p>
        {() => value.value}
        <b>tail</b>
      </p>
    ) as HTMLElement;
    host.appendChild(node);
    expect(node.textContent).toBe('onetail');
    value.value = 'two';
    expect(node.textContent).toBe('twotail');
  });

  it('attaches handlers without treating them as thunks', () => {
    const clicked = vi.fn();
    const node = (<button onClick={clicked}>go</button>) as HTMLButtonElement;
    host.appendChild(node);
    node.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
