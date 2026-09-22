/**
 * What the compiler makes of markup: the template, and the parts into it.
 *
 * Components, strict reactivity and the tooling around the transform have
 * suites of their own beside this one.
 */

import { describe, expect, it } from 'vitest';

import { compile, IMPORTS } from './compile.js';

describe('templates', () => {
  it('hoists static markup and leaves no parts behind', () => {
    const out = compile(
      `${IMPORTS}const A = component(() => <div class="row"><b>static</b></div>);`,
    );
    expect(out).toContain('_$template("<div class=\\"row\\"><b>static</b></div>")');
    expect(out).not.toContain('_$bind');
    expect(out).not.toContain('_$insert');
  });

  it('escapes text and attribute values', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p title='a"b'>{'<'}&amp;</p>);`);
    expect(out).toContain('title=\\"a&quot;b\\"');
    expect(out).toContain('&lt;&amp;</p>');
  });

  it('does not close void elements', () => {
    const out = compile(
      `${IMPORTS}const A = component(() => <div><br /><img src="x.png" /></div>);`,
    );
    expect(out).toContain('<br><img src=\\"x.png\\">');
    expect(out).not.toContain('</br>');
  });

  it('collapses adjacent text and static expressions into one node', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p>a{'b'}{1}c</p>);`);
    expect(out).toContain('<p>ab1c</p>');
  });

  it('applies JSX whitespace rules', () => {
    const out = compile(`${IMPORTS}const A = component(() => (
  <p>
    hello
    world
  </p>
));`);
    expect(out).toContain('<p>hello world</p>');
  });

  it('navigates to dynamic positions by child index', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <div><i>0</i><i>1</i><i>{props.x}</i></div>);`,
    );
    expect(out).toContain('_el$.firstChild.nextSibling.nextSibling');
  });

  it('marks a dynamic child that is followed by siblings', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p>{props.x}<b>t</b></p>);`);
    expect(out).toContain('<!>');
    expect(out).toMatch(/_\$insert\(_el\$, \(\) => props\.x, _el\$\d\)/);
  });

  it('appends a trailing dynamic child without a marker', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p><b>t</b>{props.x}</p>);`);
    expect(out).not.toContain('<!>');
    expect(out).toContain('_$insert(_el$, () => props.x)');
  });

  it('only creates variables for elements that need them', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <div><section><span>static</span></section><em>{props.x}</em></div>);`,
    );
    expect(out.match(/const _el\$\d/g) ?? []).toHaveLength(1);
  });

  it('reaches a nested element that has a part', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <div><section><span>{props.x}</span></section></div>);`,
    );
    expect(out).toContain('_el$.firstChild');
  });
});

describe('attributes', () => {
  it('routes class and style through the generic applier', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <p class={props.c} style={{ opacity: props.o }} />);`,
    );
    expect(out).toContain('_$applyProp(_el$, "class"');
    expect(out).toContain('_$applyProp(_el$, "style"');
  });

  it('uses boolean and DOM property setters where the platform requires them', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <input disabled={props.d} value={props.v} />);`,
    );
    expect(out).toContain('_$setBoolean(_el$, "disabled"');
    expect(out).toContain('_$setProperty(_el$, "value"');
  });

  it('keeps a static boolean property out of the HTML', () => {
    const out = compile(
      `${IMPORTS}const A = component(() => <input disabled={true} value="v" />);`,
    );
    expect(out).toContain('_$setBoolean(_el$, "disabled", true)');
    expect(out).toContain('_$setProperty(_el$, "value", "v")');
  });

  it('honours the prop: and attr: escapes', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <p prop:custom={props.a} attr:data-x={props.b} />);`,
    );
    expect(out).toContain('_$setProperty(_el$, "custom"');
    expect(out).toContain('_$setAttribute(_el$, "data-x"');
  });

  it('inlines static attributes, numbers included', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p tabindex={2} id="x" />);`);
    expect(out).toContain('tabindex=\\"2\\"');
    expect(out).toContain('id=\\"x\\"');
  });

  it('drops statically false and null attributes', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p hidden={false} title={null} />);`);
    expect(out).toContain('<p></p>');
  });

  it('treats a bare attribute as an empty string', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p contenteditable />);`);
    expect(out).toContain('contenteditable=\\"\\"');
  });

  it('emits a dynamic attribute for anything else', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p title={props.t} />);`);
    expect(out).toContain('_$setAttribute(_el$, "title", props.t)');
  });

  it('calls a ref with the element', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p ref={props.r} />);`);
    expect(out).toContain('props.r(_el$)');
  });

  it('spreads onto a host element inside a binding', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p {...props.rest} />);`);
    expect(out).toContain('_$spread(_el$, props.rest)');
  });

  it('uses a namespaced attribute name verbatim', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p aria:label="x" />);`);
    expect(out).toContain('aria:label=\\"x\\"');
  });
});

describe('events', () => {
  it('attaches a delegated handler', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <button onClick={props.f} />);`);
    expect(out).toContain('_$on(_el$, "click", props.f)');
  });

  it('supports the native escape hatch and option modifiers', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <button onClick:native={props.a} onKeyDown:once={props.b} />);`,
    );
    expect(out).toContain('_$on(_el$, "click", props.a, true)');
    expect(out).toContain('_$on(_el$, "keydown", props.b, {\n    once: true\n  })');
  });

  it('takes an event name verbatim after `on:`, hyphens and all', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <sl-switch on:sl-change={props.a} on:value-changed={props.b} />);`,
    );
    // No casing of an identifier produces `sl-change`, which is why the form
    // exists. JSX allows one colon in an attribute name, so this form takes no
    // modifier — `onClick:capture` is how you ask for that.
    expect(out).toContain('_$on(_el$, "sl-change", props.a)');
    expect(out).toContain('_$on(_el$, "value-changed", props.b)');
  });
});

describe('fragments and children', () => {
  it('compiles a fragment into an array', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <><b>a</b>{props.x}text</>);`);
    expect(out).toContain('[');
    expect(out).toContain('() => props.x');
    expect(out).toContain('"text"');
  });

  it('ignores JSX comments', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p>{/* nothing */}ok</p>);`);
    expect(out).toContain('<p>ok</p>');
  });
});

describe('reference detection on child elements', () => {
  it('creates a variable for a child with a spread, a ref or a dynamic attribute', () => {
    for (const child of ['<p {...props.rest} />', '<p ref={props.r} />', '<p title={props.t} />']) {
      const out = compile(`${IMPORTS}const A = component((props) => <div>${child}</div>);`);
      expect(out).toContain('const _el$1 = _el$.firstChild');
    }
  });

  it('inlines a statically true attribute as an empty value', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p contenteditable={true} />);`);
    expect(out).toContain('contenteditable=\\"\\"');
  });

  it('rejects a namespaced host element with an explanation', () => {
    expect(() => compile(`${IMPORTS}const A = component(() => <svg:circle r="2" />);`)).toThrow(
      /Namespaced element names are not supported/,
    );
  });

  it('does not rewrite a keyed map whose value is consumed by a call', () => {
    // A list part is a thunk, not an array: `wrap` could not use one.
    const out = compile(
      `${IMPORTS}const A = component((props) => <ul>{wrap(props.rows.map((row) => <li key={row.id}>x</li>))}</ul>);`,
    );
    expect(out).not.toContain('_$list(');
  });

  it('rewrites a keyed map inside a conditional or a logical expression', () => {
    const ternary = compile(
      `${IMPORTS}const A = component((props) => <ul>{props.compact ? props.rows.map((row) => <li key={row.id}>a</li>) : props.rows.map((row) => <li key={row.id}>b</li>)}</ul>);`,
    );
    expect(ternary.match(/_\$list\(/g) ?? []).toHaveLength(2);

    const logical = compile(
      `${IMPORTS}const A = component((props) => <ul>{props.show && props.rows.map((row) => <li key={row.id}>a</li>)}</ul>);`,
    );
    expect(logical).toContain('_$list(');
  });

  it('does not rewrite a keyed map used as a conditional test', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <ul>{props.rows.map((row) => <li key={row.id}>a</li>) ? 1 : 2}</ul>);`,
    );
    expect(out).not.toContain('_$list(');
  });
});
