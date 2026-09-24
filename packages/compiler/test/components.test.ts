/**
 * What the compiler makes of a component: its props, its children, its
 * declaration — and the four things it refuses to compile at all (ADR-0019).
 */

import { describe, expect, it } from 'vitest';

import { transform } from '@/api.js';

import { compile, IMPORTS } from './compile.js';

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

  it('can be turned off for a codebase that means it', () => {
    const out = transform(
      `${IMPORTS}const A = component((props) => { const id = props.id; return <p>{id}</p>; });`,
      { filename: 'src/demo.tsx', packageName: 'demo', strictReactivity: false },
    );
    expect(out).toContain('const id = props.id');
  });

  it('is on without being asked', () => {
    expect(() =>
      compile(
        `${IMPORTS}const A = component((props) => { const id = props.id; return <p>{id}</p>; });`,
      ),
    ).toThrow(/is read once/);
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

  it('re-applies a default on every read, for undefined alone', () => {
    const out = compile(`${IMPORTS}const A = component(({ count = 0 }) => <p>{count}</p>);`);
    // Not `_props.count ?? 0`, which was what this asserted and what the
    // compiler emitted: `??` answers for `null` as well, so a parent passing
    // `null` got the default back where the language would have kept the null.
    expect(out).toContain('_props.count === undefined ? 0 : _props.count');
    expect(out).not.toContain('??');
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
    // `String(a)` rather than `a`: a declaration that is nothing but a read is
    // refused by strict reactivity, and this test is about the block body.
    const out = compile(
      `${IMPORTS}const A = component(({ a, ...rest }) => { const b = String(a); return <p {...rest}>{b}</p>; });`,
    );
    expect(out).toContain('_$rest(_props, ["a"])');
    // The block the author wrote is reused: `rest` is prepended to it, and the
    // statements that were already there keep their order.
    expect(out.indexOf('const rest =')).toBeLessThan(out.indexOf('const b = String(_props.a)'));
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
