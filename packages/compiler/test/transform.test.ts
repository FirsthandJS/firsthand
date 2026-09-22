import { describe, expect, it } from 'vitest';
import { transform } from '../src/api.js';

const compile = (code: string): string =>
  transform(code, { filename: 'src/demo.tsx', packageName: 'demo' });

describe('compiler smoke', () => {
  it('compiles a counter', () => {
    const out = compile(`
import { component, signal } from '@firsthandjs/core';
export const Counter = component((props) => {
  const count = signal(props.initial);
  return <button class={count.value > 10 ? 'high' : 'normal'} onClick={() => count.value++} disabled={count.value >= 100}>Count: {count.value} <b>static</b></button>;
});
`);
    expect(out).toMatchSnapshot();
  });
});

describe('keyed lists', () => {
  it('compiles a keyed map into a list part with live item reads', () => {
    const out = compile(`
import { component } from '@firsthandjs/core';
export const Table = component((props) => (
  <tbody>
    {props.rows.map((row, i) => (
      <tr key={row.id}><td>{i}</td><td>{row.label}</td></tr>
    ))}
  </tbody>
));
`);
    expect(out).toMatchSnapshot();
  });
});

describe('a view chosen once', () => {
  const setup = (body: string): string => `
import { component, signal } from '@firsthandjs/core';
export const Panel = component((props) => {
  const open = signal(false);
  ${body}
});
`;

  it('refuses a returned branch decided by a signal', () => {
    // The mistake: this decides at setup, once, and the other branch never
    // appears. It compiled and ran and looked like a broken button.
    expect(() => compile(setup('return open.value ? <b>form</b> : <i>button</i>;'))).toThrow(
      /chosen once/,
    );
  });

  it('leaves a prop alone, because a prop may be fixed for the instance', () => {
    // The case that made this rule narrower than it started: a recursive
    // component chooses its shape from `props.depth` exactly once, on purpose,
    // and a rule that could not tell a prop from a signal refused it.
    expect(() =>
      compile(`
import { component } from '@firsthandjs/core';
export const Nested = component((props) =>
  props.depth === 0 ? <b>leaf</b> : <i>branch</i>,
);
`),
    ).not.toThrow();
  });

  it('refuses an early return guarded by a signal', () => {
    // The route-guard shape, and the one that actually shipped in the
    // showcase: after a sign-out the page it was meant to hide stayed put.
    expect(() =>
      compile(setup('if (open.value) { return <b>form</b>; } return <i>button</i>;')),
    ).toThrow(/chosen once/);
  });

  it('refuses the `&&` form, which is the same mistake with fewer characters', () => {
    expect(() => compile(setup('return open.value && <b>form</b>;'))).toThrow(/chosen once/);
  });

  it('allows the same choice inside markup, where it is a part', () => {
    expect(() =>
      compile(setup('return <>{open.value ? <b>form</b> : <i>button</i>}</>;')),
    ).not.toThrow();
  });

  it('allows a branch on something that does not change', () => {
    // A constant, a capability check, an environment flag: decided once on
    // purpose, and the rule must not stand in the way of that.
    expect(() => compile(setup('return DEV ? <b>panel</b> : <i>nothing</i>;'))).not.toThrow();
  });

  it('leaves a helper that returns no markup alone', () => {
    expect(() =>
      compile(
        setup('const label = () => (open.value ? "open" : "shut"); return <b>{label()}</b>;'),
      ),
    ).not.toThrow();
  });

  it('sees the read through the shapes people actually write', () => {
    const forms = [
      'return !open.value ? <b>a</b> : <i>b</i>;',
      'return props.busy && open.value ? <b>a</b> : <i>b</i>;',
      'return count.value > 0 ? <b>a</b> : <i>b</i>;',
      'return (open.value ? 1 : 2) > 1 ? <b>a</b> : <i>b</i>;',
    ];
    for (const form of forms) {
      expect(() => compile(setup(`const count = signal(0); ${form}`)), form).toThrow(/chosen once/);
    }
  });

  it('catches the short form, which is the one people write', () => {
    // `component(() => open.value ? <A /> : <B />)` — no block, no return
    // keyword, same mistake.
    expect(() =>
      compile(`
import { component, signal } from '@firsthandjs/core';
const open = signal(false);
export const Panel = component(() => (open.value ? <b>form</b> : <i>button</i>));
`),
    ).toThrow(/chosen once/);
  });

  it('leaves a returned choice between two non-views alone', () => {
    // No markup in either branch: a string, a number, somebody's helper.
    expect(() => compile(setup('return open.value ? "open" : "shut";'))).not.toThrow();
    expect(() => compile(setup('return open.value && "open";'))).not.toThrow();
  });

  it('sees a signal read through a member chain', () => {
    expect(() =>
      compile(`
import { component, signal } from '@firsthandjs/core';
const state = { open: signal(false) };
export const Panel = component(() => {
  return state.open.value ? <b>form</b> : <i>button</i>;
});
`),
    ).toThrow(/chosen once/);
  });

  it('leaves an early return that is not about a signal alone', () => {
    // A capability check, a prop, an argument: decided once on purpose.
    expect(() =>
      compile(setup('if (props.hidden) { return <b>nothing</b>; } return <i>panel</i>;')),
    ).not.toThrow();
    // And an `if` that returns no markup at all is somebody's guard clause.
    expect(() =>
      compile(setup('if (open.value) { throw new Error("no"); } return <i>panel</i>;')),
    ).not.toThrow();
  });

  it('leaves a constant `&&` and a bare return alone', () => {
    // Neither is the mistake: one is decided by something that does not
    // change, and the other returns nothing at all.
    expect(() => compile(setup('return DEV && <b>panel</b>;'))).not.toThrow();
    expect(() =>
      compile(setup('if (props.hidden) { return; } return <b>panel</b>;')),
    ).not.toThrow();
  });

  it('counts a fragment as markup, because it is', () => {
    expect(() => compile(setup('return open.value ? <>form</> : null;'))).toThrow(/chosen once/);
  });

  it('sees markup nested one branch deeper, on either side', () => {
    expect(() => compile(setup('return open.value ? (DEV ? <b>a</b> : <i>b</i>) : null;'))).toThrow(
      /chosen once/,
    );
    expect(() => compile(setup('return open.value ? null : (DEV ? <b>a</b> : <i>b</i>);'))).toThrow(
      /chosen once/,
    );
    // And when the markup is in the *second* branch of the nested one.
    expect(() => compile(setup('return open.value ? (DEV ? null : <b>a</b>) : null;'))).toThrow(
      /chosen once/,
    );
  });

  it('is off when strict reactivity is', () => {
    expect(() =>
      transform(setup('return open.value ? <b>form</b> : <i>button</i>;'), {
        filename: 'src/demo.tsx',
        packageName: 'demo',
        strictReactivity: false,
      }),
    ).not.toThrow();
  });
});

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

describe('a child a run keeps', () => {
  it('makes it once and feeds it through a cell', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './row.js';
export const List = component(() => () => {
  const user = profile.value;
  return <ul><Row name={user.name} /></ul>;
});
`);
    // Made once, held in its site, and handed back unchanged afterwards.
    expect(out).toContain('_$cell(');
    expect(out).toContain('_$open(');
    expect(out).toMatch(/_kept\$\d+\.last = _\$part/);
  });

  it('leaves a prop that is nobody’s local as a plain getter', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './row.js';
export const List = component(() => () => {
  const user = profile.value;
  return <ul><Row name={other.value} /></ul>;
});
`);
    expect(out).not.toContain('_$cell(');
  });

  it('feeds its children through a cell too, not only its props', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box } from './box.js';
export const Panel = component(() => () => {
  const failed = status.value === 'error';
  return <Box>{failed ? <p>no</p> : <ul>yes</ul>}</Box>;
});
`);
    // The cell holds the reading rather than the result: the child is a part,
    // and what it reads belongs to the part rather than to the run.
    expect(out).toMatch(/_\$cell\(_store, \d+, \(\) =>/);
    expect(out).toMatch(/_\$part\(\(\) => _cell\$\d+\.value\(\)\)/);
  });

  it('leaves a child that is nobody’s local where it is', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box } from './box.js';
export const Panel = component(() => () => {
  const failed = status.value === 'error';
  return <Box>{other.value}</Box>;
});
`);
    expect(out).not.toContain('_$cell(');
    expect(out).toContain('_$part(() => other.value)');
  });

  it('gives a keyed list its data from the run, and makes the list once', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => () => {
  const shown = rows.value.filter((row) => row.on);
  return <Box>{shown.map((row) => <Row key={row.id} row={row} />)}</Box>;
});
`);
    // The data is read from the cell; the list itself is still made once, or
    // a list that reuses its rows would have nothing to reuse.
    expect(out).toMatch(/_\$list\(\(\) => _cell\$\d+\.value/);
    expect(out).toMatch(/_kept\$\d+\.last = _\$part/);
  });

  it('leaves a keyed list whose data is nobody’s local alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => () => {
  const unrelated = other.value;
  return <Box>{rows.value.map((row) => <Row key={row.id} row={row} />)}</Box>;
});
`);
    expect(out).toContain('_$list(() => rows.value');
  });

  it('leaves a keyed list outside a run alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => (
  <Box>{rows.value.map((row) => <Row key={row.id} row={row} />)}</Box>
));
`);
    expect(out).toContain('_$list(() => rows.value');
    expect(out).not.toContain('_$cell(');
  });
});

describe('runs, in every shape they come in', () => {
  it('finds a run returned from a setup with no block of its own', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => () => <p>{state.value}</p>);
`);
    expect(out).toContain('_$store(');
    expect(out).toContain('_$ran(');
  });

  it('closes a run that returns nothing at all', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    if (hidden.value) {
      return;
    }
    return <p>here</p>;
  };
});
`);
    expect(out).toContain('_$ran(_store, undefined)');
  });

  it('leaves a name that only looks like ours alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
function signal(x) {
  return x;
}
export const Panel = component(() => {
  return () => {
    const n = signal(1);
    return <p>{n}</p>;
  };
});
`);
    expect(out).toContain('_$writeChild');
  });

  it('keeps a site whose spread and ref are nobody’s local', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
const attrs = { title: 'fixed' };
const keep = (node) => node;
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <p {...attrs} ref={keep}>{n}</p>;
  };
});
`);
    expect(out).toContain('_$site(');
    expect(out).toContain('_$writeChild');
  });

  it('builds a site again when its spread or its ref is the run’s', () => {
    const spread = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const attrs = { title: state.value };
    return <p {...attrs}>x</p>;
  };
});
`);
    expect(spread).not.toContain('_$site(');

    const ref = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    const keep = (node) => [node, n];
    return <p ref={keep}>x</p>;
  };
});
`);
    expect(ref).not.toContain('_$site(');
  });

  it('builds a site again when its keyed list is the run’s', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const rows = state.value.rows;
    return <ul>{rows.map((row) => <li key={row.id}>{row.n}</li>)}</ul>;
  };
});
`);
    expect(out).not.toContain('_$site(');
  });

  it('reads a property name and an object key as spellings, not as names', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const value = state.value;
    return <p title={other.value} data-x={{ value: 1 }.value}>{value}</p>;
  };
});
`);
    // `other.value` and `{ value: 1 }.value` mention `value` only as a
    // spelling, so neither is mistaken for the run's own `value`.
    expect(out).toContain('_$bind(');
  });
});

describe('runs, the last few shapes', () => {
  it('compiles markup that stands outside every function', () => {
    const out = compile(`export const fixed = <p>fixed</p>;`);
    expect(out).toContain('_$template');
  });

  it('keeps nested host elements inside a run', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return (
      <div>
        <section>
          <span>{n}</span>
        </section>
      </div>
    );
  };
});
`);
    expect(out).toContain('_$site(');
    expect(out).toContain('_$writeChild');
  });

  it('attaches a handler that belongs to the run on every run', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <button onClick={() => save(n)}>go</button>;
  };
});
`);
    // Inside the site, but not inside the block that only runs once.
    const once = out.indexOf('_$close(');
    const attach = out.indexOf('_$on(');
    expect(attach).toBeGreaterThan(once);
  });
});

describe('a key is asked of the row, not of what the row is made of', () => {
  it('accepts a keyed row whose own markup has none', () => {
    expect(() =>
      compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return (
      <div>
        {[0, 1, 2].map((row) => (
          <section key={row}>
            <span />
            <span>{n}</span>
          </section>
        ))}
      </div>
    );
  };
});
`),
    ).not.toThrow();
  });

  it('still refuses the row itself', () => {
    expect(() =>
      compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <div>{[0, 1, 2].map((row) => <section><span>{n}</span></section>)}</div>;
  };
});
`),
    ).toThrow(/appears many times/);
  });
});
