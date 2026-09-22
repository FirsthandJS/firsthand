/**
 * The route table types.
 *
 * These assertions are the feature: a route's parameters come from its own
 * path, so nothing is declared twice and a typo in `params.id` is a
 * compilation error rather than `undefined` at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { route, type ParamsOf, type RouteProps } from '@/index.js';

describe('ParamsOf', () => {
  it('reads a parameter out of a path', () => {
    expectTypeOf<ParamsOf<'users/:id'>>().toEqualTypeOf<{ readonly id: string }>();
  });

  it('reads several, at any depth', () => {
    expectTypeOf<ParamsOf<'orgs/:org/users/:id'>>().toEqualTypeOf<
      { readonly org: string } & { readonly id: string }
    >();
  });

  it('makes an optional segment optional', () => {
    expectTypeOf<ParamsOf<'users/:id?'>>().toEqualTypeOf<{ readonly id?: string }>();
  });

  it('captures a splat under its own name', () => {
    expectTypeOf<ParamsOf<'files/*'>>().toEqualTypeOf<{ readonly '*': string }>();
  });

  it('is empty for a static path', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-generated-empty-object-type
    expectTypeOf<ParamsOf<'about'>>().toEqualTypeOf<{}>();
  });
});

describe('route', () => {
  it('types a component from its own path', () => {
    route({
      path: 'users/:id',
      component: (props) => {
        expectTypeOf(props).toExtend<RouteProps>();
        expectTypeOf(props.params.id).toEqualTypeOf<string>();
        return null;
      },
    });
  });

  it('adds what the ancestors captured, through the child builder', () => {
    route({
      path: 'orgs/:org',
      children: (child) => [
        child({
          path: 'users/:id',
          component: (props) => {
            expectTypeOf(props.params.org).toEqualTypeOf<string>();
            expectTypeOf(props.params.id).toEqualTypeOf<string>();
            return null;
          },
        }),
        // An index route captures exactly what its parent did.
        child({
          index: true,
          component: (props) => {
            expectTypeOf(props.params.org).toEqualTypeOf<string>();
            return null;
          },
        }),
      ],
    });
  });

  it('rejects a parameter the path does not declare', () => {
    route({
      path: 'users/:id',
      component: (props) => {
        // @ts-expect-error — the path captures `id`, not `slug`.
        props.params.slug;
        return null;
      },
    });
  });

  it('types a lazy route the same way', () => {
    route({
      path: 'files/*',
      lazy: () =>
        Promise.resolve(
          (props: { readonly params: { readonly '*': string } }) => props.params['*'],
        ),
    });
  });
});
