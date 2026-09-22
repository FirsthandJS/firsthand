/**
 * What a deep signal leaves alone, and how it behaves beside the rest of the
 * reactive core.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch, createRoot, effect, signal } from '@firsthandjs/core';
import { deepSignal, isDeep, raw } from '@firsthandjs/deep';

/** Every test runs in its own root so nothing outlives it. */
let stop: (() => void) | null = null;
const inRoot = <T>(body: () => T): T =>
  createRoot((dispose) => {
    stop = dispose;
    return body();
  });

afterEach(() => {
  stop?.();
  stop = null;
});

describe('identity, and what stays raw', () => {
  it('returns the same proxy for the same object', () => {
    const inner = { a: 1 };
    const first = deepSignal(inner);
    const second = deepSignal(inner);

    expect(first).toBe(second);
    // Reading twice hands back the same nested proxy, so `===` still works.
    const state = deepSignal({ inner });
    expect(state.inner).toBe(state.inner);
  });

  it('does not wrap a proxy again', () => {
    const state = deepSignal({ a: 1 });
    expect(deepSignal(state)).toBe(state);
  });

  it('stores a proxy assigned back into the tree as its raw object', () => {
    const state = deepSignal<{ a: { n: number }; b?: { n: number } }>({ a: { n: 1 } });
    const branch = state.a;

    state.b = branch;

    // The tree holds one representation, so `raw` gives something clean.
    expect(isDeep(raw(state).b)).toBe(false);
    // And reading it still hands out the proxy.
    expect(state.b).toBe(state.a);
  });

  it('hands back the original object, and reports what is a proxy', () => {
    const original = { a: 1 };
    const state = deepSignal(original);

    expect(raw(state)).toBe(original);
    expect(isDeep(state)).toBe(true);
    expect(isDeep(original)).toBe(false);
    expect(isDeep(null)).toBe(false);
    expect(isDeep(42)).toBe(false);
    expect(raw(42)).toBe(42);
    expect(raw(null)).toBe(null);
  });

  it('leaves values that are not plain objects or arrays alone', () => {
    const date = new Date(0);
    const map = new Map<string, number>([['a', 1]]);
    const regexp = /x/;
    const fn = (): number => 1;
    class Point {
      constructor(readonly x = 1) {}
    }
    const point = new Point();

    const state = deepSignal({ date, map, regexp, fn, point });

    // Handed back untouched: a proxy would break their internal slots.
    expect(state.date).toBe(date);
    expect(state.map).toBe(map);
    expect(state.regexp).toBe(regexp);
    expect(state.fn).toBe(fn);
    expect(state.point).toBe(point);
    // And they still work, which is the actual point.
    expect(state.map.get('a')).toBe(1);
    expect(state.date.getTime()).toBe(0);
  });

  it('follows an object with a null prototype', () => {
    const bare = Object.create(null) as Record<string, number>;
    bare['a'] = 1;
    const state = deepSignal({ bare });
    const seen: number[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.bare['a'] ?? 0);
      });
    });

    state.bare['a'] = 2;
    expect(seen).toEqual([1, 2]);
  });
});

describe('alongside the rest of the reactive core', () => {
  it('batches with signals in one flush', () => {
    const count = signal(0);
    const state = deepSignal({ name: 'Ada' });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        count.value;
        state.name;
        runs();
      });
    });
    expect(runs).toHaveBeenCalledTimes(1);

    batch(() => {
      count.value = 1;
      state.name = 'Grace';
    });

    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('is free to write what nobody reads', () => {
    const state = deepSignal<Record<string, number>>({});
    // No effect has read anything, so no cells exist to notify. This is
    // behaviour, not an optimisation detail: writing untouched state must not
    // allocate a cell per key.
    for (let i = 0; i < 100; i++) {
      state[`key${String(i)}`] = i;
    }
    expect(Object.keys(state)).toHaveLength(100);
  });

  it('stops notifying once its root is disposed', () => {
    const state = deepSignal({ count: 0 });
    const runs = vi.fn();

    const dispose = createRoot((stopRoot) => {
      effect(() => {
        state.count;
        runs();
      });
      return stopRoot;
    });
    expect(runs).toHaveBeenCalledTimes(1);

    dispose();
    state.count = 1;

    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('refuses a write to a frozen object, as the language does', () => {
    const frozen = Object.freeze({ a: 1 });
    const state = deepSignal(frozen);

    expect(() => {
      'use strict';
      (state as { a: number }).a = 2;
    }).toThrow(TypeError);
    expect(state.a).toBe(1);
  });
});
