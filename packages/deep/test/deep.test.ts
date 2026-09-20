/**
 * Deep reactivity.
 *
 * The tests are grouped by the question each answers: what is tracked, what is
 * notified, what is left alone, and what happens at the edges where proxies
 * usually go wrong — identity, `Object.keys`, arrays, and objects that must not
 * be proxied at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch, computed, createRoot, effect, signal, untrack } from '@firsthandjs/core';
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

describe('what it tracks', () => {
  it('re-runs an effect when a property it read changes', () => {
    const state = deepSignal({ name: 'Ada' });
    const seen: string[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.name);
      });
    });
    expect(seen).toEqual(['Ada']);

    state.name = 'Grace';
    expect(seen).toEqual(['Ada', 'Grace']);
  });

  it('follows the object all the way down', () => {
    const state = deepSignal({ user: { address: { city: 'Cambridge' } } });
    const seen: string[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.user.address.city);
      });
    });

    state.user.address.city = 'London';
    expect(seen).toEqual(['Cambridge', 'London']);
  });

  it('notifies only the properties that were read', () => {
    const state = deepSignal({ a: 1, b: 2 });
    const a = vi.fn();
    const b = vi.fn();

    inRoot(() => {
      effect(() => {
        state.a;
        a();
      });
      effect(() => {
        state.b;
        b();
      });
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    state.a = 10;

    expect(a).toHaveBeenCalledTimes(2);
    // The other effect never read `a`, so nothing reached it.
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a write does not change the value', () => {
    const state = deepSignal({ count: 1 });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        state.count;
        runs();
      });
    });

    state.count = 1;
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('feeds a computed like any other read', () => {
    const state = deepSignal({ first: 'Ada', last: 'Lovelace' });
    const full = inRoot(() => computed(() => `${state.first} ${state.last}`));

    expect(full.value).toBe('Ada Lovelace');
    state.last = 'Byron';
    expect(full.value).toBe('Ada Byron');
  });

  it('is invisible inside untrack, exactly as a signal is', () => {
    const state = deepSignal({ count: 1 });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        untrack(() => state.count);
        runs();
      });
    });

    state.count = 2;
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('drops a dependency the latest run did not read', () => {
    const state = deepSignal({ show: true, text: 'hello' });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        if (state.show) {
          state.text;
        }
        runs();
      });
    });
    expect(runs).toHaveBeenCalledTimes(1);

    state.show = false;
    expect(runs).toHaveBeenCalledTimes(2);

    // `text` is no longer read, so writing it must not wake the effect.
    state.text = 'ignored';
    expect(runs).toHaveBeenCalledTimes(2);
  });
});

describe('keys coming and going', () => {
  it('notices a property that did not exist yet', () => {
    const state = deepSignal<Record<string, number>>({});
    const seen: (number | undefined)[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state['later']);
      });
    });
    expect(seen).toEqual([undefined]);

    state['later'] = 7;
    expect(seen).toEqual([undefined, 7]);
  });

  it('updates a reader of Object.keys when a key is added or removed', () => {
    const state = deepSignal<Record<string, number>>({ a: 1 });
    const seen: string[][] = [];

    inRoot(() => {
      effect(() => {
        seen.push(Object.keys(state));
      });
    });
    expect(seen).toEqual([['a']]);

    state['b'] = 2;
    expect(seen.at(-1)).toEqual(['a', 'b']);

    delete state['a'];
    expect(seen.at(-1)).toEqual(['b']);
  });

  it('updates a reader that asked whether a key exists', () => {
    const state = deepSignal<Record<string, number>>({});
    const seen: boolean[] = [];

    inRoot(() => {
      effect(() => {
        seen.push('token' in state);
      });
    });
    expect(seen).toEqual([false]);

    state['token'] = 1;
    expect(seen).toEqual([false, true]);

    delete state['token'];
    expect(seen).toEqual([false, true, false]);
  });

  it('answers a symbol `in` without tracking it', () => {
    const marker = Symbol('marker');
    const state = deepSignal<Record<PropertyKey, number>>({ [marker]: 1 });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        marker in state;
        runs();
      });
    });
    expect(runs).toHaveBeenCalledTimes(1);
    expect(marker in state).toBe(true);

    // A symbol key is not state a template can read, and tracking it would
    // mean allocating a cell for every internal symbol a library probes for.
    Reflect.deleteProperty(state, marker);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(marker in state).toBe(false);
  });

  it('leaves a delete of something that was never there alone', () => {
    const state = deepSignal<Record<string, number>>({ a: 1 });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        Object.keys(state);
        runs();
      });
    });

    delete state['missing'];
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('re-runs a for…in reader, and a spread', () => {
    const state = deepSignal<Record<string, number>>({ a: 1 });
    const keys: string[][] = [];
    const copies: Record<string, number>[] = [];

    inRoot(() => {
      effect(() => {
        const found: string[] = [];
        for (const key in state) {
          found.push(key);
        }
        keys.push(found);
      });
      effect(() => {
        copies.push({ ...state });
      });
    });

    state['b'] = 2;

    expect(keys.at(-1)).toEqual(['a', 'b']);
    expect(copies.at(-1)).toEqual({ a: 1, b: 2 });
  });
});

describe('arrays', () => {
  it('tracks an index and the length', () => {
    const state = deepSignal({ todos: ['write'] });
    const seen: string[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.todos.join(','));
      });
    });

    state.todos.push('test');
    expect(seen.at(-1)).toBe('write,test');

    state.todos[0] = 'rewrite';
    expect(seen.at(-1)).toBe('rewrite,test');

    state.todos.pop();
    expect(seen.at(-1)).toBe('rewrite');
  });

  it('counts a push as one update, not as index-then-length', () => {
    const state = deepSignal({ items: [1] });
    const runs = vi.fn();

    inRoot(() => {
      effect(() => {
        state.items.length;
        state.items[0];
        runs();
      });
    });
    expect(runs).toHaveBeenCalledTimes(1);

    state.items.push(2);
    // One logical change, one re-run: the mutator runs inside a batch.
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('follows objects inside an array', () => {
    const state = deepSignal({ rows: [{ done: false }] });
    const seen: boolean[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.rows[0]!.done);
      });
    });

    state.rows[0]!.done = true;
    expect(seen).toEqual([false, true]);
  });

  it('re-runs a length reader when an index write extends the array', () => {
    const state = deepSignal({ items: [1] });
    const seen: number[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.items.length);
      });
    });

    state.items[3] = 4;
    expect(seen.at(-1)).toBe(4);
  });

  it('works through every mutator it wraps', () => {
    const state = deepSignal({ items: [3, 1, 2] });
    const seen: string[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(state.items.join(''));
      });
    });

    state.items.sort();
    expect(seen.at(-1)).toBe('123');

    state.items.reverse();
    expect(seen.at(-1)).toBe('321');

    state.items.splice(1, 1);
    expect(seen.at(-1)).toBe('31');

    state.items.unshift(9);
    expect(seen.at(-1)).toBe('931');

    state.items.shift();
    expect(seen.at(-1)).toBe('31');

    state.items.fill(0);
    expect(seen.at(-1)).toBe('00');

    state.items.copyWithin(0, 1);
    expect(seen.at(-1)).toBe('00');
  });

  it('re-runs a reader of Object.keys on an array', () => {
    const state = deepSignal({ items: ['a'] });
    const seen: string[][] = [];

    inRoot(() => {
      effect(() => {
        seen.push(Object.keys(state.items));
      });
    });
    expect(seen).toEqual([['0']]);

    state.items.push('b');
    expect(seen.at(-1)).toEqual(['0', '1']);
  });

  it('iterates without subscribing to a symbol', () => {
    const state = deepSignal({ items: [1, 2, 3] });
    const seen: number[][] = [];

    inRoot(() => {
      effect(() => {
        seen.push([...state.items]);
      });
    });

    state.items.push(4);
    expect(seen.at(-1)).toEqual([1, 2, 3, 4]);
  });
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
