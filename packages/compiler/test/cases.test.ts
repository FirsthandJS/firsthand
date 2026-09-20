import { describe, expect, it } from 'vitest';
import { transform } from '../src/api.js';
import { stableId } from '../src/ids.js';
import { firsthand } from '../src/vite.js';
import { escapeAttribute, escapeText, eventName } from '../src/html.js';

const compile = (code: string, typescript = false): string =>
  transform(code, { filename: 'src/demo.tsx', packageName: 'demo', typescript });

const IMPORTS = "import { component } from '@firsthandjs/core';\n";

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

describe('components', () => {
  it('passes dynamic props as accessors and static props as data', () => {
    const out = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component((props) => <Child user={props.user} label="hi" flag />);`,
    );
    expect(out).toContain('get user()');
    expect(out).toContain('label: "hi"');
    expect(out).toContain('flag: true');
  });

  it('passes a single child and several children as accessors', () => {
    const one = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component(() => <Child><b>x</b></Child>);`,
    );
    expect(one).toContain('get children()');
    const many = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component(() => <Child><b>x</b><i>y</i></Child>);`,
    );
    expect(many).toContain('get children()');
    expect(many).toContain('[');
  });

  it('keeps spreads on a component', () => {
    const out = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component((props) => <Child {...props.rest} />);`,
    );
    expect(out).toContain('...props.rest');
  });

  it('supports member-expression component tags', () => {
    const out = compile(
      `${IMPORTS}import * as ui from './ui';\nconst A = component(() => <ui.Card />);`,
    );
    expect(out).toContain('_$createComponent(ui.Card');
  });

  it('quotes prop names that are not identifiers', () => {
    const out = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component(() => <Child data-id="1" />);`,
    );
    expect(out).toContain('"data-id": "1"');
  });

  it('treats a component in child position as a dynamic slot', () => {
    const out = compile(
      `${IMPORTS}import { Child } from './child';\nconst A = component(() => <div><Child /><b>t</b></div>);`,
    );
    expect(out).toContain('<!>');
    expect(out).toContain('_$createComponent(Child');
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

describe('strict reactivity', () => {
  const strict = (code: string): string =>
    transform(code, { filename: 'src/demo.tsx', packageName: 'demo', strictReactivity: true });

  it('refuses a prop read that is kept', () => {
    expect(() =>
      strict(
        `${IMPORTS}const A = component((props) => { const id = props.id; return <p>{id}</p>; });`,
      ),
    ).toThrow(/`id` is read once/);
  });

  it('refuses a signal read that is kept, arithmetic and all', () => {
    expect(() =>
      strict(
        `${IMPORTS}import { signal } from '@firsthandjs/core';
const c = signal(1);
const A = component(() => { const total = c.value * 2; return <p>{total}</p>; });`,
      ),
    ).toThrow(/`total` is read once/);
  });

  it('points at snapshot() rather than only naming the problem', () => {
    expect(() =>
      strict(
        `${IMPORTS}const A = component((props) => { const id = props.id; return <p>{id}</p>; });`,
      ),
    ).toThrow(/snapshot\(\(\) => …\)/);
  });

  it('sees a read through a template literal, an operator or a condition', () => {
    const cases = [
      'const label = `${props.name}!`;',
      'const off = !props.on;',
      'const cls = props.on ? "a" : "b";',
      'const first = props.items[0];',
    ];
    for (const line of cases) {
      expect(() =>
        strict(`${IMPORTS}const A = component((props) => { ${line} return <p>x</p>; });`),
      ).toThrow(/is read once/);
    }
  });

  it('names the declaration even when it is a pattern', () => {
    expect(() =>
      strict(
        `${IMPORTS}const A = component((props) => { const { x } = props.config; return <p>{x}</p>; });`,
      ),
    ).toThrow(/This value is read once/);
  });

  it('leaves a read that is passed to a call alone', () => {
    // `signal(props.initial)` is a starting value, which is the honest case.
    const out = strict(
      `${IMPORTS}import { signal } from '@firsthandjs/core';
const A = component((props) => { const draft = signal(props.initial); return <p>{draft.value}</p>; });`,
    );
    expect(out).toContain('signal(props.initial)');
  });

  it('leaves peek() and snapshot() alone', () => {
    const out = strict(
      `${IMPORTS}import { snapshot } from '@firsthandjs/core';
const A = component((props) => { const once = snapshot(() => props.id); return <p>{once}</p>; });`,
    );
    expect(out).toContain('snapshot(');
  });

  it('leaves a read inside a nested function alone', () => {
    const out = strict(
      `${IMPORTS}const A = component((props) => { const show = () => props.id; return <button onClick={show}>x</button>; });`,
    );
    expect(out).toContain('props.id');
  });

  it('leaves an expression-bodied setup alone', () => {
    const out = strict(`${IMPORTS}const A = component((props) => <p>{props.id}</p>);`);
    expect(out).toContain('props.id');
  });

  it('leaves a declaration that reads nothing reactive alone', () => {
    const out = strict(
      `${IMPORTS}const A = component(() => { const label = 'x' + 1; return <p>{label}</p>; });`,
    );
    expect(out).toContain("'x' + 1");
  });

  it('says nothing at all while it is off', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => { const id = props.id; return <p>{id}</p>; });`,
    );
    expect(out).toContain('const id = props.id');
  });
});

describe('keyed maps', () => {
  const rowSource = (body: string): string =>
    `${IMPORTS}const A = component((props) => <ul>${body}</ul>);`;

  it('rewrites a keyed map into a list part', () => {
    const out = compile(rowSource('{props.rows.map((row) => <li key={row.id}>{row.label}</li>)}'));
    expect(out).toContain('_$list(() => props.rows');
    expect(out).toContain('(row, _i) => row.id');
    expect(out).toContain('_item.value.label');
  });

  it('supports a block body with a return', () => {
    const out = compile(
      rowSource('{props.rows.map((row, i) => { return <li key={row.id}>{i}</li>; })}'),
    );
    expect(out).toContain('_$list(');
    expect(out).toContain('_index.value');
  });

  it('leaves a block body whose last statement is not returned JSX alone', () => {
    // No root element to hang a key on, so there is nothing to key by and the
    // map stays an ordinary array child.
    const out = compile(
      rowSource('{props.rows.map((row) => { const label = row.label; return label; })}'),
    );
    expect(out).not.toContain('_$list(');
  });

  it('leaves an unkeyed map as an ordinary array child', () => {
    const out = compile(rowSource('{props.rows.map((row) => <li>{row.label}</li>)}'));
    expect(out).not.toContain('_$list(');
  });

  it('leaves a map whose callback does not return JSX alone', () => {
    const out = compile(rowSource('{props.rows.map((row) => row.label)}'));
    expect(out).not.toContain('_$list(');
  });

  it('leaves a map with a destructured parameter alone', () => {
    const out = compile(rowSource('{props.rows.map(({ id }) => <li key={id}>x</li>)}'));
    expect(out).not.toContain('_$list(');
  });

  it('leaves other calls and computed members alone', () => {
    expect(compile(rowSource('{props.render()}'))).not.toContain('_$list(');
    expect(compile(rowSource('{props.rows["map"](fn)}'))).not.toContain('_$list(');
    expect(compile(rowSource('{props.rows.map(fn, extra)}'))).not.toContain('_$list(');
    expect(compile(rowSource('{props.rows.map(props.fn)}'))).not.toContain('_$list(');
  });

  it('leaves a keyless attribute expression alone', () => {
    const out = compile(rowSource('{props.rows.map((row) => <li id={row.id}>x</li>)}'));
    expect(out).not.toContain('_$list(');
  });

  it('handles a list as the only child and as a middle child', () => {
    const only = compile(rowSource('{props.rows.map((row) => <li key={row.id}>x</li>)}'));
    expect(only).toContain('_$insert(_el$, _$list(');
    const middle = compile(
      rowSource('{props.rows.map((row) => <li key={row.id}>x</li>)}<li>tail</li>'),
    );
    expect(middle).toContain('<!>');
  });

  it('places a list inside a fragment', () => {
    const out = compile(
      `${IMPORTS}const A = component((props) => <>{props.rows.map((row) => <li key={row.id}>x</li>)}</>);`,
    );
    expect(out).toContain('_$list(');
  });
});

describe('component declarations', () => {
  it('injects a stable id and a display name', () => {
    const out = compile(`${IMPORTS}export const Counter = component(() => <p>x</p>);`);
    expect(out).toMatch(/component\(.*, undefined, "[0-9a-f]{8}\/Counter", "Counter"\)/s);
  });

  it('keeps an options argument', () => {
    const out = compile(`${IMPORTS}const A = component(() => <p>x</p>, { shadow: true });`);
    expect(out).toContain('{\n  shadow: true\n}');
  });

  it('falls back to a generic name when not assigned to a binding', () => {
    const out = compile(`${IMPORTS}export default component(() => <p>x</p>);`);
    expect(out).toContain('"Component"');
  });

  it('leaves a component() from somewhere else alone', () => {
    const out = compile("import { component } from 'elsewhere';\nconst A = component(() => 1);");
    expect(out).not.toContain('"Component"');
    const local = 'function component(f) { return f; }\nconst A = component(() => 1);';
    expect(compile(local)).not.toContain('undefined, "');
  });

  it('leaves an already annotated call alone', () => {
    const out = compile(`${IMPORTS}const A = component(() => 1, undefined, "id", "Name");`);
    expect(out.match(/"Name"/g) ?? []).toHaveLength(1);
  });

  it('leaves a non-function first argument alone', () => {
    const out = compile(`${IMPORTS}const A = component(setup);`);
    expect(out).toContain('component(setup)');
  });

  it('rewrites destructured props into live reads', () => {
    const out = compile(
      `${IMPORTS}const A = component(({ todo, onSave }) => <p onClick={onSave}>{todo.title}</p>);`,
    );
    expect(out).toContain('_props.todo.title');
    expect(out).toContain('_props.onSave');
    expect(out).not.toContain('({ todo');
  });

  it('re-applies a default on every read', () => {
    const out = compile(`${IMPORTS}const A = component(({ count = 0 }) => <p>{count}</p>);`);
    expect(out).toContain('_props.count ?? 0');
  });

  it('follows a nested pattern', () => {
    const out = compile(`${IMPORTS}const A = component(({ user: { name } }) => <p>{name}</p>);`);
    expect(out).toContain('_props.user.name');
  });

  it('turns a rest element into a live view of the remaining props', () => {
    const out = compile(`${IMPORTS}const A = component(({ a, ...rest }) => <p {...rest}>{a}</p>);`);
    expect(out).toContain('_$rest(_props, ["a"])');
    expect(out).toContain('const rest =');
  });

  it('adds a block body when a rest element needs one', () => {
    const out = compile(`${IMPORTS}const A = component(({ ...rest }) => <p {...rest} />);`);
    expect(out).toContain('return');
    expect(out).toContain('_$rest(_props, [])');
  });

  it('reuses a block body a rest element already has', () => {
    const out = compile(
      `${IMPORTS}const A = component(({ a, ...rest }) => { const b = a; return <p {...rest}>{b}</p>; });`,
    );
    expect(out).toContain('_$rest(_props, ["a"])');
    // The block the author wrote is reused: `rest` is prepended to it, and the
    // statements that were already there keep their order.
    expect(out.indexOf('const rest =')).toBeLessThan(out.indexOf('const b = _props.a'));
  });

  it('leaves a plain identifier parameter alone', () => {
    const out = compile(`${IMPORTS}const A = component((props) => <p>{props.x}</p>);`);
    expect(out).toContain('props.x');
    expect(out).not.toContain('_props');
  });

  it('rejects patterns it cannot rewrite soundly', () => {
    expect(() => compile(`${IMPORTS}const A = component(([a]) => <p>{a}</p>);`)).toThrow(
      /must be an object pattern or a plain identifier/,
    );
    expect(() => compile(`${IMPORTS}const A = component(({ [key]: a }) => <p>{a}</p>);`)).toThrow(
      /destructured by plain key/,
    );
    expect(() => compile(`${IMPORTS}const A = component(({ a: [b] }) => <p>{b}</p>);`)).toThrow(
      /cannot be rewritten into live reads/,
    );
  });

  it('rejects assigning to a destructured prop', () => {
    expect(() =>
      compile(`${IMPORTS}const A = component(({ a }) => { a = 1; return <p>{a}</p>; });`),
    ).toThrow(/destructured from props and then assigned to/);
  });

  it('ignores a destructured binding that is never read', () => {
    const out = compile(`${IMPORTS}const A = component(({ unused }) => <p>x</p>);`);
    expect(out).toContain('_props');
  });
});

describe('TypeScript input', () => {
  it('parses annotations and leaves them for the bundler', () => {
    const out = compile(
      `${IMPORTS}type P = { x: number };\nconst A = component((props: P) => <p>{props.x}</p>);`,
      true,
    );
    expect(out).toContain('props: P');
    expect(out).toContain('_$insert');
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

describe('supporting pieces', () => {
  it('derives a stable id from the package and module path', () => {
    expect(stableId('pkg', 'src/a.tsx')).toBe(stableId('pkg', 'lib/a.tsx'));
    expect(stableId('pkg', 'src/a.tsx')).not.toBe(stableId('other', 'src/a.tsx'));
    expect(stableId('pkg', 'C:\\project\\src\\a.tsx')).toBe(stableId('pkg', 'src/a.tsx'));
  });

  it('exposes html helpers', () => {
    expect(escapeText('<&')).toBe('&lt;&amp;');
    expect(escapeAttribute('"&')).toBe('&quot;&amp;');
    expect(eventName('onPointerDown')).toBe('pointerdown');
  });

  it('provides a bundler plugin that only touches JSX modules', () => {
    const plugin = firsthand({ packageName: 'demo' });
    expect(plugin.name).toBe('firsthand');
    expect(plugin.transform('const a = 1;', '/app/main.ts')).toBeNull();
    const tsx = plugin.transform(
      `${IMPORTS}const A = component(() => <p>x</p>);`,
      '/app/main.tsx?v=1',
    );
    expect(tsx?.code).toContain('_$template');
    const jsxFile = plugin.transform(
      `${IMPORTS}const A = component(() => <p>x</p>);`,
      '/app/main.jsx',
    );
    expect(jsxFile?.code).toContain('_$template');
  });

  it('works without a filename or a package name', () => {
    const out = transform(`${IMPORTS}const A = component(() => <p>x</p>);`);
    expect(out).toMatch(/"[0-9a-f]{8}\/A"/);
    expect(transform('')).toBe('');
  });

  it('rejects an element used directly as an attribute value', () => {
    expect(() => compile(`${IMPORTS}const A = component(() => <p title=<b /> />);`)).toThrow(
      /not a valid attribute value/,
    );
  });
});
