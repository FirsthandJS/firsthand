/**
 * The same spread, in the browser, as the server writes it.
 *
 * The other half of `packages/server/test/spread-parity.test.ts`: the same
 * inputs, asserted against the element a browser ends up with. The server file
 * asserts the markup for these; together they are one table, and a change to
 * either belongs in both.
 *
 * These are the reference side. Where the two disagreed it was the server that
 * was wrong, because this is what an application already sees after hydration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProp } from '@/props.js';

describe('what the browser builds from a spread', () => {
  let node: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    node = document.createElement('div');
    document.body.appendChild(node);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('toggles a class record on truthiness, not on `true`', () => {
    applyProp(node, 'class', { open: 1, shut: 0, gone: null, named: 'yes' });

    expect(node.className).toBe('open named');
  });

  it('applies a style record', () => {
    applyProp(node, 'style', { color: 'red', marginTop: '4px' });

    expect(node.style.color).toBe('red');
    expect(node.style.marginTop).toBe('4px');
  });

  it('drops a style declaration with no value', () => {
    applyProp(node, 'style', { color: null, border: undefined });

    expect(node.getAttribute('style')).toBe(null);
  });

  it('sets a `prop:` as a property, not as an attribute', () => {
    const input = document.createElement('input');
    applyProp(input, 'prop:value', 'typed');

    expect(input.value).toBe('typed');
    // The name is the framework's, and never appears in the markup.
    expect(input.getAttribute('prop:value')).toBe(null);
  });

  it('sets an `attr:` under its real name', () => {
    applyProp(node, 'attr:data-open', 'yes');

    expect(node.getAttribute('data-open')).toBe('yes');
    expect(node.getAttribute('attr:data-open')).toBe(null);
  });

  it('writes a boolean attribute as the browser reflects it', () => {
    const button = document.createElement('button');
    applyProp(button, 'disabled', true);
    expect(button.disabled).toBe(true);

    applyProp(button, 'disabled', false);
    expect(button.disabled).toBe(false);
  });

  it('writes nothing for a value that is not there', () => {
    applyProp(node, 'title', null);
    applyProp(node, 'lang', undefined);

    expect(node.outerHTML).toBe('<div></div>');
  });
});
