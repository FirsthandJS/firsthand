/**
 * A component that takes a view and puts it somewhere.
 *
 * `{ children?: View }` is the most ordinary prop there is — a panel, a layout,
 * a card — and a component receives its props as `ReadonlyProps`, which is
 * `DeepReadonly` applied to every value. That has an exception for DOM nodes,
 * for exactly this reason. It did not have one for the other thing a `View` can
 * be: the `DynamicChild` the compiler emits for `{expression}`. Descending into
 * that one reaches its owner, whose `disposals` and `cells` are mutable arrays,
 * and `readonly T[]` is not assignable to `T[]` — so the prop no longer fits
 * the element it came from, and the component does not compile.
 *
 * Nothing was ever wrong at runtime: `DeepReadonly` exists only in the type
 * system, and the same object is passed straight through.
 */
import { describe, expect, it } from 'vitest';
import { component, type ReadonlyProps, type View } from '@firsthandjs/dom';
import { mount } from '@firsthandjs/testing';

describe('a view arriving as a prop', () => {
  it('goes into an element', () => {
    const Panel = component((props: ReadonlyProps<{ children?: View }>) => (
      <main>{props.children}</main>
    ));

    const view = mount(() => <Panel>a child</Panel>);

    expect(view.text()).toBe('a child');
  });

  it('goes into a fragment', () => {
    const Bare = component((props: ReadonlyProps<{ children?: View }>) => <>{props.children}</>);

    const view = mount(() => <Bare>bare</Bare>);

    expect(view.text()).toBe('bare');
  });

  it('goes into an element under a name of its own', () => {
    const Card = component((props: ReadonlyProps<{ heading: View; body: View }>) => (
      <article>
        <h2>{props.heading}</h2>
        <p>{props.body}</p>
      </article>
    ));

    const view = mount(() => <Card heading="title" body="text" />);

    expect(view.text()).toBe('titletext');
  });
});
