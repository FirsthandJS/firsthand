/**
 * Strict reactivity: the development-only report for a read that happens once.
 *
 * The check lives in the reactive core, at the one place where a read finds
 * nothing subscribing, but it only means something inside a component setup —
 * so it is exercised from here, where components exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  catchError,
  computed,
  effect,
  setStrictReactivity,
  signal,
  snapshot,
} from '@firsthandjs/core';
import { component } from '../../src/component.js';
import { render } from '../../src/render.js';

let warn: MockInstance<typeof console.warn>;
let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  setStrictReactivity(true);
});

afterEach(() => {
  setStrictReactivity(false);
  warn.mockRestore();
});

/** The messages this module produces, ignoring anything else on the console. */
const reports = (): string[] =>
  warn.mock.calls
    .map((call) => String(call[0]))
    .filter((text) => text.includes('read in a component setup'));

describe('what it reports', () => {
  it('names a prop copied out of the graph in setup', () => {
    const count = signal(1);
    const Label = component<{ total: number }>((props) => {
      const total = props.total; // frozen the moment it is read
      return <p>{total}</p>;
    });

    render(() => <Label total={count.value} />, host);

    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('snapshot()');
  });

  it('names a signal read in setup', () => {
    const count = signal(1);
    const Label = component(() => {
      const doubled = count.value * 2;
      return <p>{doubled}</p>;
    });

    render(() => <Label />, host);

    expect(reports()).toHaveLength(1);
  });

  it('reports a call site once, however many instances there are', () => {
    const count = signal(1);
    const Label = component<{ total: number }>((props) => {
      const total = props.total;
      return <p>{total}</p>;
    });

    render(
      () => (
        <>
          <Label total={count.value} />
          <Label total={count.value} />
          <Label total={count.value} />
        </>
      ),
      host,
    );

    expect(reports()).toHaveLength(1);
  });

  it('reports inside a custom element host as well', () => {
    const count = signal(1);
    const Boxed = component<{ total: number }>(
      (props) => {
        const total = props.total;
        return <p>{total}</p>;
      },
      { tag: true },
      'pkg/StrictBoxed',
      'StrictBoxed',
    );

    render(() => <Boxed total={count.value} />, host);

    expect(reports()).toHaveLength(1);
  });
});

describe('what it leaves alone', () => {
  it('says nothing when the read is in a part', () => {
    const count = signal(1);
    const Label = component<{ total: number }>((props) => <p>{props.total}</p>);

    render(() => <Label total={count.value} />, host);

    expect(reports()).toEqual([]);
  });

  it('says nothing about a read inside an effect or a computed', () => {
    const count = signal(1);
    const Label = component(() => {
      const doubled = computed(() => count.value * 2);
      effect(() => void count.value);
      return <p>{doubled.value}</p>;
    });

    render(() => <Label />, host);

    expect(reports()).toEqual([]);
  });

  it('says nothing about a read in an event handler', () => {
    const count = signal(1);
    const seen: number[] = [];
    const Button = component(() => <button onClick={() => seen.push(count.value)}>go</button>);

    render(() => <Button />, host);
    host.querySelector('button')?.click();

    expect(seen).toEqual([1]);
    expect(reports()).toEqual([]);
  });

  it('says nothing when the read is wrapped in snapshot()', () => {
    const count = signal(1);
    const Field = component<{ initial: number }>((props) => {
      // The starting value of something editable: it must not follow the prop.
      const draft = signal(snapshot(() => props.initial));
      return <p>{draft.value}</p>;
    });

    render(() => <Field initial={count.value} />, host);

    expect(reports()).toEqual([]);
  });

  it('says nothing about peek(), which already states the intent', () => {
    const count = signal(1);
    const Label = component(() => {
      const once = count.peek();
      return <p>{once}</p>;
    });

    render(() => <Label />, host);

    expect(reports()).toEqual([]);
  });

  it('says nothing at all while it is switched off', () => {
    setStrictReactivity(false);
    const count = signal(1);
    const Label = component(() => {
      const doubled = count.value * 2;
      return <p>{doubled}</p>;
    });

    render(() => <Label />, host);

    expect(reports()).toEqual([]);
  });

  it('says nothing about a read outside any component', () => {
    const count = signal(1);
    const doubled = count.value * 2;

    expect(doubled).toBe(2);
    expect(reports()).toEqual([]);
  });
});

describe('the setup marker stays balanced', () => {
  it('leaves setup behind when the body throws', () => {
    const count = signal(1);
    const failed = vi.fn();
    const Broken = component(() => {
      throw new Error('no');
    });

    catchError(() => render(() => <Broken />, host), failed);
    expect(failed).toHaveBeenCalledTimes(1);
    warn.mockClear();

    // A read outside any component, after the throw. It is only quiet if the
    // setup frame was popped on the error path as well as the ordinary one.
    const after = count.value;

    expect(after).toBe(1);
    expect(reports()).toEqual([]);
  });
});
