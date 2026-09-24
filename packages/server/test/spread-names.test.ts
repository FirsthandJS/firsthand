/**
 * What a spread may write as an attribute name.
 *
 * `{...props}` is the one place a runtime object decides the *names* in the
 * markup rather than the values. Values have always been escaped; names were
 * interpolated as they arrived. A key with a space in it therefore became two
 * attributes, and the second one could be an event handler:
 *
 *     spread({ 'x onmouseover': 'alert(1)' })  →  ` x onmouseover="alert(1)"`
 *
 * An application that spreads a dictionary it did not write — a row from a
 * database, a query string, a JSON body — hands the page's author whoever
 * wrote that dictionary. The browser refuses the same name outright, because
 * `setAttribute` throws on it, so this was also a place where a server and a
 * browser disagreed about what the markup is.
 *
 * The rule now: a name a spread writes has to look like an attribute name,
 * and it may not be an `on*` handler. A real handler reaches the DOM through
 * the event path, never through a serialized attribute, so nothing that works
 * loses anything — and an inline handler out of untrusted data cannot be
 * written at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spread } from '@firsthandjs/server/internal';

describe('a name a spread would write', () => {
  beforeEach(() => {
    // Refusing says so, and a suite that prints every refusal is a suite whose
    // output stops being read.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('says which name it refused, rather than dropping it in silence', () => {
    spread({ onmouseover: 'alert(1)' });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('onmouseover'));
  });

  it('refuses one that would open a second attribute', () => {
    expect(spread({ 'x onmouseover': 'alert(1)' })).toBe('');
  });

  it('refuses one carrying a quote, which would close the value', () => {
    expect(spread({ 'a"b': 'v' })).toBe('');
    expect(spread({ "a'b": 'v' })).toBe('');
  });

  it('refuses one carrying a bracket, which would close the tag', () => {
    expect(spread({ 'a>b': 'v' })).toBe('');
    expect(spread({ 'a/b': 'v' })).toBe('');
    expect(spread({ 'a=b': 'v' })).toBe('');
  });

  it('refuses an inline handler however it is spelled', () => {
    // The old guard asked for an upper-case letter after `on`, which is the
    // spelling a component writes and not the one an attacker does.
    expect(spread({ onmouseover: 'alert(1)' })).toBe('');
    expect(spread({ ONERROR: 'alert(1)' })).toBe('');
    expect(spread({ onClick: 'alert(1)' })).toBe('');
  });

  it('writes the ordinary names an application actually spreads', () => {
    expect(spread({ id: 'seven' })).toBe(' id="seven"');
    expect(spread({ 'data-open': 'yes' })).toBe(' data-open="yes"');
    expect(spread({ 'aria-label': 'Close' })).toBe(' aria-label="Close"');
    expect(spread({ 'xml:lang': 'en' })).toBe(' xml:lang="en"');
    expect(spread({ viewBox: '0 0 1 1' })).toBe(' viewBox="0 0 1 1"');
  });

  it('still escapes the value, which was never the hole', () => {
    // `&` and `"` only: inside a quoted value, `<` and `>` are text, and a
    // serializer that escaped them would differ from the tree a browser
    // builds from the same markup.
    expect(spread({ title: '"><script>alert(1)</script>' })).toBe(
      ' title="&quot;><script>alert(1)</script>"',
    );
  });
});
