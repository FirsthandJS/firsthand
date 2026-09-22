/**
 * The pieces the compiler's server output is made of.
 *
 * The parity suite proves the pieces agree with the browser for every shape
 * the compiler emits; these are the cases a component cannot reach — the empty
 * ones, the refused ones, and the ones an application calls by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  renderToString,
  renderToStringAsync,
  Markup,
  escapeAttribute,
  escapeText,
} from '@firsthandjs/server';
import {
  child,
  createComponent,
  spread,
  ssr,
  setAttribute,
  setBoolean,
  setClass,
  setProperty,
  setStyle,
  view,
} from '@firsthandjs/server/internal';
import { catchError, component } from '@firsthandjs/dom';

describe('escaping', () => {
  it('leaves text alone when there is nothing to escape', () => {
    expect(escapeText('plain')).toBe('plain');
  });

  it('escapes the characters that end a text node', () => {
    expect(escapeText('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('escapes one at the start and one at the end', () => {
    expect(escapeText('&a')).toBe('&amp;a');
    expect(escapeText('a&')).toBe('a&amp;');
    expect(escapeText('&')).toBe('&amp;');
  });

  it('leaves an attribute alone when there is nothing to escape', () => {
    expect(escapeAttribute('plain')).toBe('plain');
  });

  it('escapes the characters that end an attribute', () => {
    expect(escapeAttribute('a "b" & c')).toBe('a &quot;b&quot; &amp; c');
  });

  it('escapes one at the start and one at the end', () => {
    expect(escapeAttribute('"a')).toBe('&quot;a');
    expect(escapeAttribute('a"')).toBe('a&quot;');
  });
});

describe('attributes', () => {
  it('writes nothing for null, undefined and false', () => {
    expect(setAttribute('title', null)).toBe('');
    expect(setAttribute('title', undefined)).toBe('');
    expect(setAttribute('title', false)).toBe('');
  });

  it('writes an empty value for true', () => {
    expect(setAttribute('hidden', true)).toBe(' hidden=""');
  });

  it('writes a number as its text', () => {
    expect(setAttribute('tabindex', 2)).toBe(' tabindex="2"');
  });

  it('writes the attribute a boolean property stands for', () => {
    expect(setBoolean('checked', true)).toBe(' checked=""');
    expect(setBoolean('checked', false)).toBe('');
    expect(setBoolean('checked', 1)).toBe(' checked=""');
    expect(setBoolean('checked', null)).toBe('');
    expect(setBoolean('checked', 0)).toBe('');
  });

  it('lowercases a property name that is spelled for JavaScript', () => {
    expect(setBoolean('readOnly', true)).toBe(' readonly=""');
  });
});

describe('properties', () => {
  it('writes nothing for a property no attribute can seed', () => {
    expect(setProperty('scrollTop', 10)).toBe('');
    expect(setProperty('somethingElse', 10)).toBe('');
  });

  it('writes the attribute that seeds the ones that can', () => {
    expect(setProperty('value', 'a')).toBe(' value="a"');
    expect(setProperty('className', 'a')).toBe(' class="a"');
    expect(setProperty('htmlFor', 'a')).toBe(' for="a"');
  });
});

describe('class', () => {
  it('writes a string as it stands', () => {
    expect(setClass('a b')).toBe(' class="a b"');
  });

  it('writes nothing at all for nothing at all', () => {
    expect(setClass(null)).toBe('');
    expect(setClass(undefined)).toBe('');
  });

  it('writes the truthy names of a record, and no attribute when there are none', () => {
    expect(setClass({ a: true, b: 0, c: 'yes' })).toBe(' class="a c"');
    expect(setClass({ a: false })).toBe('');
  });

  it('writes the truthy entries of an array, including none of them', () => {
    expect(setClass(['a', '', 'b'])).toBe(' class="a b"');
    expect(setClass([])).toBe(' class=""');
  });

  it('writes anything else as its text', () => {
    expect(setClass(7)).toBe(' class="7"');
  });
});

describe('style', () => {
  it('writes nothing for nothing', () => {
    expect(setStyle(null)).toBe('');
    expect(setStyle(undefined)).toBe('');
  });

  it('writes a string as it stands', () => {
    expect(setStyle('color: red')).toBe(' style="color: red"');
  });

  it('hyphenates the names of a record and leaves out the empty ones', () => {
    expect(setStyle({ marginTop: '1px', color: null })).toBe(' style="margin-top: 1px;"');
  });

  it('leaves a custom property spelled as it was written', () => {
    expect(setStyle({ '--brand': 'red' })).toBe(' style="--brand: red;"');
  });

  it('writes no attribute for a record with nothing in it', () => {
    expect(setStyle({})).toBe('');
  });
});

describe('markup', () => {
  it('is one part when there is nothing between', () => {
    expect(ssr(['<p></p>']).html).toBe('<p></p>');
  });

  it('interleaves the parts with the values', () => {
    expect(ssr(['<p>', '</p>'], 'hi').html).toBe('<p>hi</p>');
  });

  it('writes nothing where a value is nothing', () => {
    expect(ssr(['<p>', '</p>'], null).html).toBe('<p></p>');
  });
});

describe('a child position', () => {
  it('renders nothing for nothing', () => {
    expect(child(null)).toBe('');
    expect(child(undefined)).toBe('');
    expect(child(false)).toBe('');
  });

  it('escapes text but not markup', () => {
    expect(child('<b>')).toBe('&lt;b&gt;');
    expect(child(new Markup('<b></b>'))).toBe('<b></b>');
  });

  it('renders numbers, including big ones', () => {
    expect(child(7)).toBe('7');
    expect(child(BigInt(7))).toBe('7');
  });

  it('renders an array in order', () => {
    expect(child(['a', new Markup('<b/>'), 1])).toBe('a<b/>1');
  });

  it('calls a function and renders what it returns', () => {
    expect(child(() => 'a')).toBe('a');
  });

  it('renders anything else as its text', () => {
    expect(child({ toString: () => '<x>' })).toBe('&lt;x&gt;');
  });
});

describe('a spread', () => {
  it('leaves out what a server cannot write', () => {
    expect(spread({ ref: () => undefined, onClick: () => undefined, children: 'x' })).toBe('');
  });

  it('writes a class from any of its shapes', () => {
    expect(spread({ class: 'a' })).toBe(' class="a"');
    expect(spread({ className: ['a', false] })).toBe(' class="a"');
    expect(spread({ class: { a: true, b: false } })).toBe(' class="a"');
    expect(spread({ class: null })).toBe('');
    expect(spread({ class: 7 })).toBe(' class="7"');
  });

  it('leaves a style record to the client, which has a CSSOM', () => {
    expect(spread({ style: { color: 'red' } })).toBe('');
  });

  it('writes everything else as an attribute', () => {
    expect(spread({ title: 'a', hidden: false })).toBe(' title="a"');
  });
});

describe('instantiating', () => {
  it('renders a view function where it stands', () => {
    const Label = view((props: { text: string }) => new Markup(`<b>${props.text}</b>`));
    expect(child(createComponent(Label as never, { text: 'hi' }))).toBe('<b>hi</b>');
  });

  it('says so when a component is not one of ours', () => {
    const Foreign = (): string => 'x';
    expect(() => createComponent(Foreign as never, {})).toThrow(/not a Firsthand component/);
  });

  it('names the value when the function is anonymous', () => {
    const anonymous = (): string => 'x';
    Object.defineProperty(anonymous, 'name', { value: '' });
    expect(() => createComponent(anonymous as never, {})).toThrow(/The value is not/);
  });

  it('hands what a setup threw to the boundary above it, as the browser does', () => {
    const Broken = component(() => {
      throw new Error('no');
    });
    let caught: unknown;
    const html = renderToString(() =>
      catchError(
        () => createComponent(Broken as never, {}),
        (error) => {
          caught = error;
        },
      ),
    );
    expect((caught as Error).message).toBe('no');
    expect(html).toBe('');
  });

  it('writes a hosted component as its element', () => {
    const Host = component(() => new Markup('<i></i>') as never, { tag: 'x-host' });
    expect(child(createComponent(Host as never, {}))).toBe('<x-host><i></i></x-host>');
  });

  it('writes a shadow root the only way markup can', () => {
    const Shadowed = component(() => new Markup('<i></i>') as never, {
      tag: 'x-shadow',
      shadow: true,
    });
    expect(child(createComponent(Shadowed as never, {}))).toBe(
      '<x-shadow><template shadowrootmode="open"><i></i></template></x-shadow>',
    );
  });
});

describe('rendering a document', () => {
  it('returns the body alone when nothing wraps it', () => {
    expect(renderToString(() => new Markup('<p></p>'))).toBe('<p></p>');
  });

  it('wraps the body when something does', () => {
    expect(
      renderToString(() => new Markup('<p></p>'), {
        document: (body) => `<!doctype html><body>${body}</body>`,
      }),
    ).toBe('<!doctype html><body><p></p></body>');
  });

  it('is a promise around the same thing when there is nothing to wait for', async () => {
    await expect(renderToStringAsync(() => new Markup('<p></p>'))).resolves.toBe('<p></p>');
  });

  it('stops early once two passes agree', async () => {
    let passes = 0;
    const html = await renderToStringAsync(
      () => {
        passes++;
        return new Markup('<p></p>');
      },
      { settle: () => Promise.resolve(), passes: 5 },
    );
    expect(html).toBe('<p></p>');
    expect(passes).toBe(2);
  });

  it('renders every pass it is given when nothing ever agrees', async () => {
    let passes = 0;
    await renderToStringAsync(
      () => {
        passes++;
        return new Markup(`<p>${String(passes)}</p>`);
      },
      { settle: () => Promise.resolve(), passes: 3 },
    );
    expect(passes).toBe(3);
  });
});
