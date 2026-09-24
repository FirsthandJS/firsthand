/**
 * The same spread, on the server and in the browser.
 *
 * A spread is the one place where the *shapes* in the markup come from a
 * runtime object, so it is the place where a server and a browser are most
 * likely to disagree — and a disagreement here is not a cosmetic one: it is
 * markup the client then has to correct, which is a page that moves after it
 * has been painted.
 *
 * Every case below is asserted twice: here against the markup the server
 * writes, and in `packages/dom/test/spread-parity.test.ts` against the element
 * the browser builds from the same input. The two files are one table; a
 * change to either belongs in both.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spread } from '@firsthandjs/server/internal';

describe('a spread writes what the browser would build', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('toggles a class record on truthiness, not on `true`', () => {
    // `setClassList` does `!!value[name]`. The server asked for `=== true`, so
    // `{ open: 1 }` — a flag out of JSON, a count, a non-empty string — was a
    // class in the browser and no class at all in the markup.
    expect(spread({ class: { open: 1 } })).toBe(' class="open"');
    expect(spread({ class: { open: 'yes' } })).toBe(' class="open"');
    expect(spread({ class: { open: 0, shut: false, gone: null } })).toBe('');
  });

  it('writes a style record', () => {
    expect(spread({ style: { color: 'red', marginTop: 4 } })).toBe(
      ' style="color: red; margin-top: 4;"',
    );
  });

  it('drops a style declaration with no value, as the CSSOM does', () => {
    expect(spread({ style: { color: null, border: undefined } })).toBe('');
  });

  it('writes a `prop:` only where a parser seeds the property', () => {
    // A property is not markup. `value` is the one that matters in practice
    // and the parser does seed it; `scrollTop` is not something HTML can say,
    // so it produces nothing and hydration sets it. What must not happen is
    // the literal `prop:scrollTop="40"` the server used to write.
    expect(spread({ 'prop:value': 'typed' })).toBe(' value="typed"');
    expect(spread({ 'prop:scrollTop': 40 })).toBe('');
  });

  it('writes an `attr:` under its real name', () => {
    expect(spread({ 'attr:data-open': 'yes' })).toBe(' data-open="yes"');
  });

  it('refuses an `attr:` whose real name is not one', () => {
    expect(spread({ 'attr:onmouseover': 'alert(1)' })).toBe('');
    expect(spread({ 'attr:x y': 'v' })).toBe('');
  });

  it('writes a boolean attribute as the browser reflects it', () => {
    expect(spread({ disabled: true })).toBe(' disabled=""');
    expect(spread({ disabled: false })).toBe('');
  });

  it('writes nothing for a value that is not there', () => {
    expect(spread({ title: null, lang: undefined })).toBe('');
  });
});
