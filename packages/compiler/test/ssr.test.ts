/**
 * What the compiler emits for a server render.
 *
 * The proof that the two outputs mean the same thing is in
 * `packages/server/test/parity.test.ts`, which renders the same components
 * both ways and compares the trees. What is asserted here is the emission
 * itself: which runtime is imported, what is left out, and where the markers
 * hydration navigates by end up.
 */
import { describe, expect, it } from 'vitest';
import { transform } from '../src/api.js';

/** A quote as it appears inside the emitted string literal. */
const QUOTE = '\\"';

const compile = (code: string, ssr = true): string =>
  transform(code, { filename: '/app/view.tsx', typescript: true, packageName: 'app', ssr });

describe('a server build', () => {
  it('imports the server runtime rather than the DOM one', () => {
    const out = compile('export const A = () => <p>hi</p>;');
    expect(out).toContain('@firsthandjs/server/internal');
    expect(out).not.toContain('@firsthandjs/dom/internal');
  });

  it('emits one string when there is nothing dynamic', () => {
    const out = compile('export const A = () => <p class="lead">hi</p>;');
    expect(out).toContain('_$ssr(["<p class=\\"lead\\">hi</p>"])');
  });

  it('escapes what it writes into an attribute and into text', () => {
    const out = compile('export const A = () => <p title={"a"} class="a&b">x &lt; y</p>;');
    expect(out).toContain('class=' + QUOTE + 'a&amp;b' + QUOTE);
    expect(out).toContain('x &lt; y');
  });

  it('closes a tag unless the parser closes it', () => {
    const out = compile('export const A = () => <div><br /><img src="a" /></div>;');
    expect(out).toContain('<br><img src=' + QUOTE + 'a' + QUOTE + '></div>');
  });

  it('writes an attribute with no value as an empty one', () => {
    expect(compile('export const A = () => <input disabled />;')).toContain(
      'disabled=' + QUOTE + QUOTE,
    );
  });

  it('writes an attribute whose static value is `true` as an empty one', () => {
    expect(compile('export const A = () => <p hidden={true}>x</p>;')).toContain(
      'hidden=' + QUOTE + QUOTE,
    );
  });

  it('writes an option`s value as the property it has to be', () => {
    expect(compile('export const A = (p) => <option value={p.v}>x</option>;')).toContain(
      '_$setProperty("value", p.v)',
    );
  });

  it('leaves out an attribute that is statically absent', () => {
    const out = compile('export const A = () => <p hidden={false} lang={null}>x</p>;');
    expect(out).toContain('_$ssr(["<p>x</p>"])');
  });

  it('writes a static number as its text', () => {
    expect(compile('export const A = () => <p tabIndex={2}>x</p>;')).toContain(
      'tabIndex=' + QUOTE + '2' + QUOTE,
    );
  });

  it('leaves out the handlers and refs a server cannot attach', () => {
    const out = compile(
      'export const A = (p) => <button onClick={p.go} ref={p.el} on:custom={p.go}>x</button>;',
    );
    expect(out).toContain('_$ssr(["<button>x</button>"])');
  });

  it('leaves out the key, which is an instruction rather than an attribute', () => {
    const out = compile(
      'export const A = (p) => <ul>{p.rows.map((r) => <li key={r.id}>{r.n}</li>)}</ul>;',
    );
    expect(out).not.toContain('key=');
  });

  it('calls the helper that matches each kind of attribute', () => {
    const out = compile(
      'export const A = (p) => <input attr:data-x={p.a} prop:value={p.b} class={p.c} ' +
        'style={p.d} checked={p.e} value={p.f} title={p.g} />;',
    );
    expect(out).toContain('_$setAttribute("data-x", p.a)');
    expect(out).toContain('_$setProperty("value", p.b)');
    expect(out).toContain('_$setClass(p.c)');
    expect(out).toContain('_$setStyle(p.d)');
    expect(out).toContain('_$setBoolean("checked", p.e)');
    expect(out).toContain('_$setProperty("value", p.f)');
    expect(out).toContain('_$setAttribute("title", p.g)');
  });

  it('writes a spread through the server`s own', () => {
    expect(compile('export const A = (p) => <p {...p.rest}>x</p>;')).toContain('_$spread(p.rest)');
  });

  it('opens a region before every dynamic child', () => {
    const out = compile('export const A = (p) => <p>Hello, {p.name}!</p>;');
    expect(out).toContain('"<p>Hello, <!--[-->"');
    expect(out).toContain('"<!---->!</p>"');
  });

  it('marks no region at all when the child is the whole element', () => {
    // Where the element's children start is where the region starts, and the
    // element's end is where it stops. Both are already in the markup.
    const out = compile('export const A = (p) => <p>{p.name}</p>;');
    expect(out).toContain('_$ssr(["<p>", "</p>"]');
    expect(out).not.toContain('<!--[-->');
  });

  it('marks a last child that is not the only one, because its start is not visible', () => {
    const out = compile('export const A = (p) => <p>head{p.name}</p>;');
    expect(out).toContain('"<p>head<!--[-->"');
    expect(out).toContain('"</p>"');
  });

  it('calls a view function where it stands, with no part around it', () => {
    const out = compile(
      'const Label = (p) => <b>{p.text}</b>;\nexport const A = (p) => <p><Label text={p.t} /></p>;',
    );
    expect(out).not.toContain('_$part');
    expect(out).toContain('Label({');
  });

  it('puts a fragment`s dynamic children in the array as they are', () => {
    const out = compile('export const A = (p) => <>{p.a}<b>x</b></>;');
    expect(out).not.toContain('_$part');
    expect(out).toContain('p.a');
  });

  it('emits no devtools labels, which belong to a panel in a browser', () => {
    const out = transform('import {signal} from "@firsthandjs/core"; const c = signal(0);', {
      filename: '/app/view.tsx',
      typescript: true,
      packageName: 'app',
      devtools: true,
      ssr: true,
    });
    expect(out).not.toContain('label');
  });

  it('leaves the key out of a component`s props as well', () => {
    const out = compile(
      'const C = component(() => null); ' +
        'export const A = (p) => <ul>{p.rows.map((r) => <C key={r.id} row={r} />)}</ul>;',
    );
    expect(out).not.toContain('key:');
    expect(out).not.toContain('get key(');
  });

  it('writes a prop nobody could notice being read early as a value', () => {
    const out = compile('export const A = (p) => <C row={p.row} n={p.a.b[p.i]} />;');
    expect(out).toContain('row: p.row');
    expect(out).toContain('n: p.a.b[p.i]');
    expect(out).not.toContain('get row(');
  });

  it('writes the operators over such reads as values too', () => {
    const out = compile(
      'export const A = (p) => <C a={!p.x} b={p.x + 1} c={p.x && p.y} d={p.x ? 1 : 2} ' +
        'e={`${p.x}!`} f={[p.x, , p.y]} g={{ x: p.x }} />;',
    );
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(out).not.toContain(`get ${name}(`);
    }
  });

  it('keeps an accessor where evaluating early could be noticed', () => {
    const out = compile(
      'export const A = (p) => <C a={p.get()} b={delete p.x} c={p.i++} d={new P()} ' +
        'e={{ [p.k]: 1 }} f={{ ...p.rest }} g={[p.get()]} h={`${p.get()}`} ' +
        'i={p.x ? p.get() : 1} j={p.x && p.get()} k={-p.get()} l={p.a[p.get()]} />;',
    );
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      expect(out).toContain(`get ${name}(`);
    }
  });

  it('still writes accessors in a browser build, where props are live', () => {
    const out = transform('export const A = (p) => <C row={p.row} />;', {
      filename: '/app/view.tsx',
      typescript: true,
      packageName: 'app',
    });
    expect(out).toContain('get row(');
  });

  it('says which element name it cannot write', () => {
    expect(() => compile('export const A = () => <svg:rect />;')).toThrow(/svg:rect/);
  });
});

describe('a build that can hydrate', () => {
  const hydratable = (code: string): string =>
    transform(code, {
      filename: '/app/view.tsx',
      typescript: true,
      packageName: 'app',
      hydratable: true,
    });

  it('walks the template through helpers that can step over a region', () => {
    const out = hydratable('export const A = (p) => <p>a{p.b}c{p.d}e</p>;');
    expect(out).toContain('_$first(_el$)');
    expect(out).toContain('_$next(');
    expect(out).not.toContain('.firstChild');
    expect(out).not.toContain('.nextSibling');
  });

  it('is off by default, so a build without a server pays nothing', () => {
    const out = transform('export const A = (p) => <p>a{p.b}c</p>;', {
      filename: '/app/view.tsx',
      typescript: true,
      packageName: 'app',
    });
    expect(out).toContain('.firstChild');
    expect(out).not.toContain('_$first(');
  });

  it('is not emitted for a server build, which has no template to walk', () => {
    const out = transform('export const A = (p) => <p>a{p.b}c</p>;', {
      filename: '/app/view.tsx',
      typescript: true,
      packageName: 'app',
      ssr: true,
      hydratable: true,
    });
    expect(out).not.toContain('_$first(');
  });
});
