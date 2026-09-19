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
