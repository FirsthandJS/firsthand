/**
 * A render function's sites: what it keeps between runs, and what it may not
 * do at all.
 *
 * The store is what survives a run (ADR-0026). A site is kept when everything
 * the run has to put into it is something the compiler can write; when it is
 * not, the site is built again, which is always correct and merely slower.
 */

import { describe, expect, it } from 'vitest';

import { compile } from './compile.js';

describe('view functions', () => {
  it('calls a local function that markup was compiled into', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
function Badge({ value }) {
  return <em>{value}</em>;
}
export const Panel = component((props) => <div><Badge value={props.label} /></div>);
`);
    // The call goes straight into the child slot, which is already a scope.
    expect(out).toContain('Badge({');
    expect(out).not.toContain('createComponent(Badge');
    // And the module says what it is, for anyone importing it.
    expect(out).toContain('_$view(Badge)');
  });

  it('leaves a local function alone when no markup was compiled into it', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { createElement } from 'react';
function Toned() {
  return createElement('span', null, 'hi');
}
export const Panel = component(() => <div><Toned /></div>);
`);
    // Another framework's component, declared here. It contains nothing this
    // compiler translated, so it stays a runtime decision and reaches the
    // adapter as before.
    expect(out).toContain('createComponent(Toned');
    expect(out).not.toContain('_$view(Toned)');
  });

  it('wraps the call in a part where there is no child slot around it', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
function Badge() {
  return <em>x</em>;
}
export const Panel = component(() => <Badge />);
`);
    expect(out).toContain('_$part(() => Badge({');
  });

  it('marks an exported declaration and an exported const alike', () => {
    const out = compile(`
export function One() {
  return <i>one</i>;
}
export const Two = () => <i>two</i>;
const Three = function () {
  return <i>three</i>;
};
`);
    expect(out).toContain('_$view(One)');
    expect(out).toContain('_$view(Two)');
    expect(out).toContain('_$view(Three)');
  });

  it('does not mark a setup, a nested declaration or an anonymous callback', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  function Inner() {
    return <i>inner</i>;
  }
  return <div><Inner />{[1].map((n) => <b key={n}>{n}</b>)}</div>;
});
`);
    // A setup is not a view, and a nested function needs no mark: the tag
    // that names it is in the same module and was resolved there.
    expect(out).not.toContain('_$view(Panel)');
    expect(out).not.toContain('_$view(Inner)');
    expect(out).toContain('Inner({');
  });

  it('marks the enclosing function when the markup is built in a helper', () => {
    const out = compile(`
export function Badge() {
  const render = () => <i>x</i>;
  return render();
}
`);
    expect(out).toContain('_$view(Badge)');
  });

  it('leaves an imported name, a reassigned one and a non-function to the runtime', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Imported } from './elsewhere.js';
let Swapped = () => <i>a</i>;
Swapped = () => <i>b</i>;
const NotAFunction = 42;
export const Panel = component(() => (
  <div>
    <Imported />
    <Swapped />
    <NotAFunction />
  </div>
));
`);
    expect(out).toContain('createComponent(Imported');
    expect(out).toContain('createComponent(Swapped');
    expect(out).toContain('createComponent(NotAFunction');
  });

  it('leaves a member-expression tag to the runtime', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import * as ui from './ui.js';
export const Panel = component(() => <div><ui.Badge /></div>);
`);
    expect(out).toContain('createComponent(ui.Badge');
  });
});

describe('view functions, awkward shapes', () => {
  it('handles a nameless default export and a nested const view', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export default function () {
  return <i>anonymous</i>;
}
export const Panel = component(() => {
  const Nested = function () {
    return <b>nested</b>;
  };
  return <div><Nested /></div>;
});
`);
    // Nothing to mark for the anonymous one, and the nested one needs no mark.
    expect(out).not.toContain('_$view(undefined)');
    expect(out).not.toContain('_$view(Nested)');
    // It is still resolved where it is used.
    expect(out).toContain('Nested({');
  });

  it('calls a module-level function expression written as a tag', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
const Badge = function () {
  return <i>x</i>;
};
export const Panel = component(() => <div><Badge /></div>);
`);
    expect(out).toContain('Badge({');
    expect(out).toContain('_$view(Badge)');
  });

  it('leaves a class and a parameter to the runtime', () => {
    const out = compile(`
class Thing {}
export function Wrapper(Given) {
  return <div><Thing /><Given /></div>;
}
`);
    // Neither is a function this module declared markup inside, and a
    // parameter is not knowable at all until it arrives.
    expect(out).toContain('createComponent(Thing');
    expect(out).toContain('createComponent(Given');
  });

  it('does not mark an object method that builds markup', () => {
    const out = compile(`
export const ui = {
  badge() {
    return <i>x</i>;
  },
};
`);
    // A method has no name of its own to import, and the object it sits on is
    // not a function, so nothing is marked.
    expect(out).not.toContain('_$view(');
  });
});

describe('what a render function may not do', () => {
  const render = (body: string): string => `
import { component, signal, effect } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    ${body}
  };
});
`;

  it('refuses a signal made in the run', () => {
    expect(() => compile(render('const n = signal(0); return <b>{n.value}</b>;'))).toThrow(
      /makes a signal/,
    );
  });

  it('refuses an effect made in the run', () => {
    expect(() => compile(render('effect(() => {}); return <b>x</b>;'))).toThrow(/makes an effect/);
  });

  it('allows one inside a handler, which runs on its own terms', () => {
    expect(() =>
      compile(render('return <b onClick={() => { effect(() => {}); }}>x</b>;')),
    ).not.toThrow();
  });

  it('allows one in the setup, above the run', () => {
    expect(() =>
      compile(`
import { component, signal } from '@firsthandjs/dom';
export const Panel = component(() => {
  const n = signal(0);
  return () => <b>{n.value}</b>;
});
`),
    ).not.toThrow();
  });

  it('refuses repeated markup without a key', () => {
    expect(() =>
      compile(
        render('const out = []; for (const row of rows) { out.push(<li>{row}</li>); } return out;'),
      ),
    ).toThrow(/appears many times/);
  });

  it('refuses an unkeyed map in a run', () => {
    expect(() => compile(render('return <ul>{rows.map((r) => <li>{r}</li>)}</ul>;'))).toThrow(
      /appears many times/,
    );
  });

  it('accepts a keyed map and a keyed loop', () => {
    expect(() =>
      compile(render('return <ul>{rows.map((r) => <li key={r.id}>{r.n}</li>)}</ul>;')),
    ).not.toThrow();
    expect(() =>
      compile(
        render(
          'const out = []; for (const r of rows) { out.push(<li key={r.id}>{r.n}</li>); } return out;',
        ),
      ),
    ).not.toThrow();
  });

  it('leaves a setup that returns markup alone', () => {
    expect(() =>
      compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => <ul>{rows.map((r) => <li>{r}</li>)}</ul>);
`),
    ).not.toThrow();
  });
});
