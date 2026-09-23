/**
 * A styled component as a branch of a ternary.
 *
 * The plain-element version of this is covered in `@firsthandjs/dom`
 * (`status-strip.test.tsx`) and works. The question here is whether a styled
 * component behaves the same in that position — it is a component wrapping an
 * element rather than an element, and the branch that loses has to leave the
 * document rather than merely lose its text.
 *
 * The case comes from the playground, where the compile-error panel is a
 * styled `div`: the report was that clearing the error emptied the box instead
 * of closing it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';
import { resetStyles, styled } from '@firsthandjs/styled';

afterEach(() => {
  cleanup();
  resetStyles();
});

const Status = styled.div`
  color: teal;
`;

const Problem = styled.div`
  border: 1px solid red;
`;

const Empty = styled.div`
  opacity: 0.5;
`;

const Say = component<{ readonly ready: boolean; readonly problem: string }>((props) => () => (
  <>
    {props.problem === '' ? (
      <Status data-role="status">{props.ready ? 'running' : 'starting'}</Status>
    ) : (
      <Problem data-role="problem" role="alert">
        {props.problem}
      </Problem>
    )}
    {props.ready ? '' : <Empty data-role="empty">warming up</Empty>}
  </>
));

const find = (host: ParentNode, role: string): Element | null =>
  host.querySelector(`[data-role="${role}"]`);

describe('a styled component in a branch', () => {
  it('leaves the document when the branch loses', () => {
    const problem = signal('boom');
    const { container: host } = mount(() => <Say ready={true} problem={problem.value} />);

    expect(find(host, 'problem')?.textContent).toBe('boom');
    expect(find(host, 'status')).toBeNull();

    problem.value = '';

    // Gone, not emptied.
    expect(find(host, 'problem')).toBeNull();
    expect(find(host, 'status')?.textContent).toBe('running');
  });

  it('drops a styled branch whose alternative is an empty string', () => {
    const ready = signal(false);
    const { container: host } = mount(() => <Say ready={ready.value} problem="" />);

    expect(find(host, 'empty')?.textContent).toBe('warming up');

    ready.value = true;

    expect(find(host, 'empty')).toBeNull();
  });

  it('swaps back and forth without leaving either behind', () => {
    const problem = signal('');
    const { container: host } = mount(() => <Say ready={true} problem={problem.value} />);

    expect(find(host, 'status')).not.toBeNull();
    problem.value = 'boom';
    expect(find(host, 'status')).toBeNull();
    expect(find(host, 'problem')?.textContent).toBe('boom');
    problem.value = '';
    expect(find(host, 'problem')).toBeNull();
    expect(find(host, 'status')).not.toBeNull();
  });
});
