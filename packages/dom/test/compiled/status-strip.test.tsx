/**
 * A ternary between two elements, in a child component, over reactive props.
 *
 * This is the playground's status strip, reduced. It renders one of two
 * elements depending on a string prop, and the branch that loses must actually
 * leave the document — an error box that empties instead of closing is a
 * different thing on the screen from no error box at all.
 *
 * The shape matters and is why this is not covered by the ternary tests
 * elsewhere: the condition is read from `props`, the props are passed as
 * `x={signal.value}` at the call site, and the losing branch interpolates the
 * same prop the condition tests. If a branch is kept and only its text is
 * updated, the markup below still "works" by text content — so these assertions
 * are about which elements exist.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

const Say = component<{ readonly ready: boolean; readonly problem: string }>((props) => () => (
  <>
    {props.problem === '' ? (
      <span class="status">{props.ready ? 'running' : 'starting'}</span>
    ) : (
      <strong class="problem">{props.problem}</strong>
    )}
    {props.ready ? '' : <em class="empty">warming up</em>}
  </>
));

describe('the status strip', () => {
  it('replaces the problem with the status when the problem clears', () => {
    const problem = signal('boom');
    const { container: host } = mount(() => <Say ready={true} problem={problem.value} />);

    expect(host.querySelector('.problem')?.textContent).toBe('boom');
    expect(host.querySelector('.status')).toBeNull();

    problem.value = '';

    // The box must be gone, not emptied.
    expect(host.querySelector('.problem')).toBeNull();
    expect(host.querySelector('.status')?.textContent).toBe('running');
  });

  it('drops the warming-up line once it is ready', () => {
    const ready = signal(false);
    const { container: host } = mount(() => <Say ready={ready.value} problem="" />);

    expect(host.querySelector('.empty')?.textContent).toBe('warming up');

    ready.value = true;

    expect(host.querySelector('.empty')).toBeNull();
    expect(host.querySelector('.status')?.textContent).toBe('running');
  });

  it('swaps back again, so the branch is not simply one-way', () => {
    const problem = signal('');
    const { container: host } = mount(() => <Say ready={true} problem={problem.value} />);

    expect(host.querySelector('.status')).not.toBeNull();
    problem.value = 'boom';
    expect(host.querySelector('.problem')?.textContent).toBe('boom');
    expect(host.querySelector('.status')).toBeNull();
    problem.value = '';
    expect(host.querySelector('.problem')).toBeNull();
    expect(host.querySelector('.status')).not.toBeNull();
  });
});
