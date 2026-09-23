/**
 * A run that returns one branch, and then another.
 *
 * The branch it left has to go: cleanups run, nodes leave the page, and what
 * is on screen is the branch it returned. That held until #47 gave a
 * fragment's children sites of their own — and then, for a fragment only,
 * both branches stayed on screen at once.
 *
 * The cause was a wrapper. A kept child is a part; the thunk `compileChildren`
 * puts around a dynamic child made it a part inside a part, and the inner one
 * looked its site up only when the thunk ran — which is after `ran` has ended
 * the run. The site was stamped with the next run's generation, so the next
 * `ran` read a branch the run had left as one it had just reached, and left it
 * alone. For ever.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, onCleanup, signal } from '@firsthandjs/dom';

afterEach(cleanup);

const A = component(() => <p data-a>A</p>);
const B = component(() => <p data-b>B</p>);

describe('a run that returns a fragment', () => {
  it('leaves nothing behind when it returns a different one', () => {
    const which = signal('a');
    const View = component(() => () => {
      if (which.value === 'a') {
        return (
          <>
            <A />
            <span>meta a</span>
          </>
        );
      }
      return (
        <>
          <B />
          <span>meta b</span>
        </>
      );
    });
    const view = mount(() => <View />);
    expect(view.text()).toBe('Ameta a');

    which.value = 'b';
    expect(view.all('[data-b]')).toHaveLength(1);
    expect(view.all('[data-a]')).toHaveLength(0);
    expect(view.text()).toBe('Bmeta b');
  });

  it('is the same for a single element, which never broke', () => {
    const which = signal('a');
    const View = component(() => () => (which.value === 'a' ? <A /> : <B />));
    const view = mount(() => <View />);

    which.value = 'b';
    expect(view.all('[data-a]')).toHaveLength(0);
    expect(view.text()).toBe('B');
  });
  it('runs the cleanups of the branch it left', () => {
    // The assertion that says the site was disposed rather than merely
    // overwritten: a component that is gone from the page but never cleaned
    // up is a subscription nobody can reach and nobody will stop.
    let cleaned = 0;
    const which = signal('a');
    const Watched = component(() => {
      onCleanup(() => {
        cleaned += 1;
      });
      return <p data-a>A</p>;
    });
    const View = component(
      () => () =>
        which.value === 'a' ? (
          <>
            <Watched />
            <span>meta</span>
          </>
        ) : (
          <>
            <B />
            <span>meta</span>
          </>
        ),
    );
    mount(() => <View />);

    which.value = 'b';
    expect(cleaned).toBe(1);
  });

  it('keeps the child while the branch is the same one', () => {
    // The other half: #47 is what makes a fragment's child survive a run, and
    // this is that — the same element object, across a run that changed
    // something else.
    const tick = signal(0);
    const Row = component(() => <p data-row>row</p>);
    const View = component(() => () => (
      <>
        <Row />
        <span>{String(tick.value)}</span>
      </>
    ));
    const view = mount(() => <View />);
    const first = view.get('[data-row]');

    tick.value = 1;
    expect(view.get('[data-row]')).toBe(first);
    expect(view.text()).toContain('1');
  });
});
