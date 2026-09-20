/**
 * What `deepSignal` accepts, and what it hands back.
 *
 * The restriction to objects and arrays is the point of these: a `Map`, a
 * `Date` or a class instance satisfies `object` but cannot survive being
 * proxied, so it has to fail at compile time rather than at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { deepSignal, isDeep, raw, type Deep } from '@firsthandjs/deep';

describe('what it accepts', () => {
  it('takes a plain object and gives back the same shape', () => {
    const state = deepSignal({ name: 'Ada', age: 36 });
    expectTypeOf(state).toEqualTypeOf<{ name: string; age: number }>();
    expectTypeOf(state.name).toEqualTypeOf<string>();
  });

  it('takes an array, and keeps its element type', () => {
    const list = deepSignal(['a', 'b']);
    expectTypeOf(list).toEqualTypeOf<string[]>();
    expectTypeOf(list[0]).toEqualTypeOf<string | undefined>();
  });

  it('keeps nested shapes, at any depth', () => {
    const state = deepSignal({ user: { address: { city: 'Cambridge' } }, tags: ['x'] });
    expectTypeOf(state.user.address.city).toEqualTypeOf<string>();
    expectTypeOf(state.tags).toEqualTypeOf<string[]>();
  });

  it('refuses a primitive', () => {
    // @ts-expect-error — a number has no properties to track.
    deepSignal(1);
    // @ts-expect-error — nor has a string.
    deepSignal('text');
    // @ts-expect-error — and null is not an object to follow.
    deepSignal(null);
  });

  it('refuses the objects a proxy would break', () => {
    // @ts-expect-error — a Map reads its internal slots through `this`.
    deepSignal(new Map<string, number>());
    // @ts-expect-error — so does a Set.
    deepSignal(new Set<number>());
    // @ts-expect-error — a Date's methods do too.
    deepSignal(new Date());
    // @ts-expect-error — a function is not state.
    deepSignal(() => 1);
  });

  it('refuses a class instance, because its prototype carries behaviour', () => {
    class Point {
      constructor(readonly x = 0) {}
      distance(): number {
        return this.x;
      }
    }
    // @ts-expect-error — methods and private fields do not survive proxying.
    deepSignal(new Point());
  });
});

describe('the helpers', () => {
  it('unwraps to the same type it was given', () => {
    const state = deepSignal({ a: 1 });
    expectTypeOf(raw(state)).toEqualTypeOf<{ a: number }>();
    // `raw` accepts anything, because it is what you reach for when you are
    // not sure whether you are holding a proxy.
    expectTypeOf(raw(42)).toEqualTypeOf<number>();
  });

  it('reports a proxy as a boolean', () => {
    expectTypeOf(isDeep({})).toEqualTypeOf<boolean>();
  });

  it('exposes what it considers deep-able', () => {
    expectTypeOf<Record<string, number>>().toExtend<Deep>();
    expectTypeOf<number[]>().toExtend<Deep>();
  });
});
