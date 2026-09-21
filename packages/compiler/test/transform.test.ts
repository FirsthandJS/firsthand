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
