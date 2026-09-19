/**
 * Type-level tests for the public API.
 *
 * These assert things the runtime tests cannot: that a computed has no setter,
 * that context tokens are not interchangeable, that props are deeply readonly,
 * and that the inference a developer relies on actually happens. They are
 * checked by `npm run test:types`, which runs the type checker over the
 * assertions rather than executing them.
 */
import { assertType, describe, expectTypeOf, it } from 'vitest';
import {
  batch,
  catchError,
  computed,
  createContext,
  createRoot,
  effect,
  onCleanup,
  provide,
  signal,
  untrack,
  useContext,
  type Context,
  type DeepReadonly,
  type Dispose,
  type ReadonlyCell,
  type ReadonlyProps,
  type Signal,
} from '../src/index.js';

describe('signal', () => {
  it('infers the value type and stays writable', () => {
    const count = signal(0);
    expectTypeOf(count).toEqualTypeOf<Signal<number>>();
    expectTypeOf(count.value).toBeNumber();
    expectTypeOf(count.peek()).toBeNumber();
    count.value = 1;
    count.set((previous) => previous + 1);
  });

  it('keeps an explicit type parameter', () => {
    type Theme = { mode: 'light' | 'dark' };
    const theme = signal<Theme>({ mode: 'light' });
    expectTypeOf(theme.value).toEqualTypeOf<Theme>();
    // @ts-expect-error a theme mode outside the union is not assignable
    theme.value = { mode: 'sepia' };
  });

  it('rejects a value of the wrong type', () => {
    const count = signal(0);
    // @ts-expect-error a number signal does not take a string
    count.value = 'one';
  });

  it('types the custom equality against the value', () => {
    signal({ id: 1 }, { equals: (a, b) => a.id === b.id });
    signal(0, { equals: false });
    // @ts-expect-error the comparator sees the value type, not `unknown`
    signal(0, { equals: (a: string, b: string) => a === b });
  });
});

describe('computed', () => {
  it('is read-only at the type level', () => {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    expectTypeOf(doubled).toEqualTypeOf<ReadonlyCell<number>>();
    expectTypeOf(doubled.value).toBeNumber();
    // @ts-expect-error a computed has no setter
    doubled.value = 4;
    // @ts-expect-error and no functional update either
    doubled.set(() => 4);
  });

  it('infers through a chain', () => {
    const source = signal('text');
    const length = computed(() => source.value.length);
    const even = computed(() => length.value % 2 === 0);
    expectTypeOf(even.value).toBeBoolean();
  });
});

describe('effects and lifecycle', () => {
  it('accepts a body with or without a cleanup', () => {
    expectTypeOf(effect(() => undefined)).toEqualTypeOf<Dispose>();
    effect(() => () => undefined);
    // @ts-expect-error a cleanup must be a function, not a value
    effect(() => 42);
  });

  it('passes values through batch, untrack and createRoot', () => {
    expectTypeOf(batch(() => 'value')).toBeString();
    expectTypeOf(untrack(() => 7)).toBeNumber();
    expectTypeOf(createRoot((dispose) => dispose)).toEqualTypeOf<Dispose>();
    expectTypeOf(createRoot(() => ({ a: 1 }))).toEqualTypeOf<{ a: number }>();
  });

  it('marks catchError as possibly not returning a value', () => {
    expectTypeOf(catchError(() => 1, console.error)).toEqualTypeOf<number | undefined>();
  });

  it('takes a zero-argument cleanup', () => {
    onCleanup(() => undefined);
    // @ts-expect-error onCleanup does not pass anything to its callback
    onCleanup((value: number) => value);
  });
});

describe('context', () => {
  type Theme = { mode: 'light' | 'dark' };
  type User = { name: string };

  it('returns a read-only cell of the token type', () => {
    const ThemeContext = createContext<Theme>();
    expectTypeOf(useContext(ThemeContext)).toEqualTypeOf<ReadonlyCell<Theme>>();
    expectTypeOf(useContext(ThemeContext).value.mode).toEqualTypeOf<'light' | 'dark'>();
  });

  it('does not let tokens of different types stand in for each other', () => {
    const ThemeContext = createContext<Theme>();
    const UserContext = createContext<User>();
    const wantsTheme = (context: Context<Theme>): ReadonlyCell<Theme> => useContext(context);
    wantsTheme(ThemeContext);
    // @ts-expect-error a user token is not a theme token, despite the same shape
    wantsTheme(UserContext);
  });

  it('accepts a value or a cell when providing', () => {
    const ThemeContext = createContext<Theme>();
    provide(ThemeContext, { mode: 'dark' });
    provide(ThemeContext, signal<Theme>({ mode: 'dark' }));
    provide(
      ThemeContext,
      computed((): Theme => ({ mode: 'light' })),
    );
    // @ts-expect-error the value has to match the token
    provide(ThemeContext, { name: 'Ada' });
  });

  it('types the default value against the token', () => {
    const withDefault = createContext<number>(0, 'Count');
    expectTypeOf(useContext(withDefault).value).toBeNumber();
    // @ts-expect-error the default must match the token type
    createContext<number>('zero');
  });
});

describe('props', () => {
  type Props = {
    user: { name: string; tags: string[] };
    items: readonly number[];
    onSave: (value: string) => void;
  };

  it('is readonly at every level', () => {
    const props = {} as ReadonlyProps<Props>;
    expectTypeOf(props.user.name).toBeString();
    expectTypeOf(props.onSave).toBeFunction();
    // @ts-expect-error a top-level prop cannot be assigned
    props.user = { name: 'x', tags: [] };
    // @ts-expect-error nor a nested one
    props.user.name = 'x';
    // @ts-expect-error nor an element of a nested array
    props.user.tags[0] = 'x';
  });

  it('leaves functions callable and does not rewrite their signatures', () => {
    const props = {} as ReadonlyProps<Props>;
    props.onSave('value');
    // @ts-expect-error the argument type survives
    props.onSave(1);
  });

  it('deep-readonly leaves built-ins alone', () => {
    expectTypeOf<DeepReadonly<Date>>().toEqualTypeOf<Date>();
    expectTypeOf<DeepReadonly<(value: number) => string>>().toEqualTypeOf<
      (value: number) => string
    >();
    assertType<ReadonlyMap<string, ReadonlyArray<string>>>(
      {} as DeepReadonly<Map<string, string[]>>,
    );
  });
});
