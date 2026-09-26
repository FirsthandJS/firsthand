/**
 * Where a provider may stand.
 *
 * `provide` puts a value on the current scope, and a reader resolves through
 * the scope it was created in — so the question is never "how high is the
 * provider", it is "was this reader built under it". A wrapper component
 * provides for its children in every shape an application actually writes,
 * which is what these pin.
 *
 * The exception is markup that was already built. A component's children are
 * built by whoever writes them, so a local variable holding markup was built in
 * that scope and reads its context from there. No context system can undo that:
 * by the time the provider runs, the reader already has a scope. Holding a
 * function instead of markup is the whole fix, and the last two tests show both
 * halves of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, createContext, provide, useContext, type View } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

const Theme = createContext<string>('light', 'theme');
const Reader = component(() => <span>{useContext(Theme).value}</span>);

const Provider = component((props: { children?: View }) => {
  provide(Theme, 'dark');
  return <div>{props.children}</div>;
});

describe('a provider that is not the root', () => {
  it('reaches children written inside it', () => {
    const view = mount(() => (
      <Provider>
        <Reader />
      </Provider>
    ));

    expect(view.text()).toBe('dark');
  });

  it('reaches children when it returns a fragment', () => {
    const Bare = component((props: { children?: View }) => {
      provide(Theme, 'bare');
      return <>{props.children}</>;
    });

    const view = mount(() => (
      <Bare>
        <Reader />
      </Bare>
    ));

    expect(view.text()).toBe('bare');
  });

  it('reaches a child handed down as a prop from above it', () => {
    const Outer = component((props: { slot: View }) => <Provider>{props.slot}</Provider>);

    const view = mount(() => <Outer slot={<Reader />} />);

    expect(view.text()).toBe('dark');
  });

  it('nests, and the nearest one wins', () => {
    const Inner = component((props: { children?: View }) => {
      provide(Theme, 'inner');
      return <section>{props.children}</section>;
    });

    const view = mount(() => (
      <Provider>
        <Inner>
          <Reader />
        </Inner>
      </Provider>
    ));

    expect(view.text()).toBe('inner');
  });

  it('reaches a component held in a local, because it is built where it is used', () => {
    const view = mount(() => {
      const Held = Reader;
      return (
        <Provider>
          <Held />
        </Provider>
      );
    });

    expect(view.text()).toBe('dark');
  });

  it('reaches a function held in a local, for the same reason', () => {
    const view = mount(() => {
      const child = () => <Reader />;
      return <Provider>{child}</Provider>;
    });

    expect(view.text()).toBe('dark');
  });

  it('does not reach markup that was already built, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const view = mount(() => {
      // Built here, so its scope is here, and here has no provider.
      const child = <Reader />;
      return <Provider>{child}</Provider>;
    });

    expect(view.text()).toBe('light');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('built before the provider existed'));
  });
});
