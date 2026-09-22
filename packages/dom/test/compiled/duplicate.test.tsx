/**
 * A run that hands back what it made.
 *
 * A site exists so that a run which happens again writes into the nodes it
 * already has. Where those nodes belong to a component the run put in its
 * markup, what the site keeps is a *part* — and the same part object comes
 * back out of every run. Mounting it a second time puts a second copy of the
 * component on the page beside the first, which is what this is about: the
 * page looked right until a resource answered, and then it had the panel
 * twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, signal, type View } from '@firsthandjs/dom';

afterEach(cleanup);

type BoxProps = { readonly children?: View };

/*
 * The cast is a types-only gap, not a runtime one: `ReadonlyProps` descends
 * into `View`'s dynamic-child member, which carries an owner, and a deeply
 * readonly owner is no longer one. The same note stands in the server
 * fixtures and in `docs/reference/dom.md`.
 */
const Box = component<BoxProps>((props) => <section>{props.children as View}</section>);

describe('a run whose markup holds a component', () => {
  it('keeps the one it made when a local of the run changes', () => {
    const status = signal('loading');
    const Panel = component(() => () => {
      // A local, which is what makes the run happen again rather than a part
      // inside it. The site keeps the component the run put in its markup.
      const failed = status.value === 'error';
      return (
        <Box>
          <h2>Facts</h2>
          {failed ? <p>failed</p> : <ul>{null}</ul>}
        </Box>
      );
    });
    const view = mount(() => (
      <article>
        <Panel />
      </article>
    ));
    const section = view.get('section');
    expect(view.all('section')).toHaveLength(1);

    status.value = 'success';
    expect(view.all('section')).toHaveLength(1);
    expect(view.get('section')).toBe(section);

    status.value = 'error';
    expect(view.all('section')).toHaveLength(1);
    expect(view.all('h2')).toHaveLength(1);
  });

  it('mounts it again when it was taken away and put back', () => {
    // The other half of the same rule: a part that is not on the page is not
    // bound, and the child a conditional brings back is the same object.
    const shown = signal(true);
    const App = component(() => () => (shown.value ? <Box>here</Box> : <p>away</p>));
    const view = mount(() => (
      <article>
        <App />
      </article>
    ));
    expect(view.all('section')).toHaveLength(1);

    shown.value = false;
    expect(view.all('section')).toHaveLength(0);
    expect(view.text()).toBe('away');

    shown.value = true;
    expect(view.all('section')).toHaveLength(1);
    expect(view.text()).toBe('here');
  });
});
