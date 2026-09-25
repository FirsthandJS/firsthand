/**
 * A `View` survives `DeepReadonly`.
 *
 * `ReadonlyProps` applies `DeepReadonly` to every prop, and the most ordinary
 * prop there is holds markup: `children?: View`. If `DeepReadonly` descends
 * into anything a `View` can be and changes it, the prop no longer fits the
 * element it came from, and a component that renders its own children stops
 * compiling — while working perfectly at runtime, because `DeepReadonly` is a
 * type and nothing is frozen or copied.
 *
 * These are here, beside the definition, rather than in the DOM package,
 * because the exceptions being asserted are `DeepReadonly`'s.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { DeepReadonly, ReadonlyProps } from '@firsthandjs/core';
import type { View } from '@firsthandjs/dom';

describe('DeepReadonly and a view', () => {
  it('leaves a whole View alone', () => {
    expectTypeOf<DeepReadonly<View>>().toEqualTypeOf<View>();
  });

  it('leaves the children prop assignable to what it came from', () => {
    type Props = ReadonlyProps<{ children?: View }>;
    expectTypeOf<Props['children']>().toExtend<View | undefined>();
  });

  it('still makes ordinary data deeply readonly', () => {
    type Props = ReadonlyProps<{ user: { tags: string[] } }>;
    expectTypeOf<Props['user']['tags']>().toEqualTypeOf<readonly string[]>();
  });
});
