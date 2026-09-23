/**
 * A run that changes the *shape* of what it returns.
 *
 * The disposal bug fixed in 0.11.1 was found with a fragment replaced by
 * another fragment, and the test written for it pairs that with a single
 * element replaced by a single element. Neither covers the case where the
 * shape itself changes — a fragment becoming one element, or one element
 * becoming a fragment — and those take different paths through the child
 * slot: one node against a list of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, onCleanup, signal } from '@firsthandjs/dom';

afterEach(cleanup);

const A = component(() => <p data-a>A</p>);
const B = component(() => <p data-b>B</p>);

describe('a run that changes what shape it returns', () => {
  it('replaces a fragment with a single element', () => {
    const many = signal(true);
    const View = component(
      () => () =>
        many.value ? (
          <>
            <A />
            <span data-extra>and more</span>
          </>
        ) : (
          <B />
        ),
    );
    const view = mount(() => <View />);
    expect(view.all('[data-a]')).toHaveLength(1);
    expect(view.all('[data-extra]')).toHaveLength(1);

    many.value = false;
    expect(view.all('[data-b]')).toHaveLength(1);
    expect(view.all('[data-a]')).toHaveLength(0);
    expect(view.all('[data-extra]')).toHaveLength(0);
    expect(view.text()).toBe('B');
  });

  it('replaces a single element with a fragment', () => {
    const many = signal(false);
    const View = component(
      () => () =>
        many.value ? (
          <>
            <A />
            <span data-extra>and more</span>
          </>
        ) : (
          <B />
        ),
    );
    const view = mount(() => <View />);
    expect(view.all('[data-b]')).toHaveLength(1);

    many.value = true;
    expect(view.all('[data-a]')).toHaveLength(1);
    expect(view.all('[data-extra]')).toHaveLength(1);
    expect(view.all('[data-b]')).toHaveLength(0);
    expect(view.text()).toBe('Aand more');
  });

  it('disposes what it left behind, whichever shape it was', () => {
    const gone = vi.fn();
    const many = signal(true);
    const Held = component(() => {
      onCleanup(gone);
      return <i data-held />;
    });
    const View = component(
      () => () =>
        many.value ? (
          <>
            <Held />
            <span>beside it</span>
          </>
        ) : (
          <B />
        ),
    );
    const view = mount(() => <View />);
    expect(view.all('[data-held]')).toHaveLength(1);

    // Nodes going is visible; cleanups running is not, and a branch that is
    // detached without being disposed keeps its effects alive for ever.
    many.value = false;
    expect(gone).toHaveBeenCalledTimes(1);
    expect(view.all('[data-held]')).toHaveLength(0);
  });

  it('comes back to a shape it has had before', () => {
    const many = signal(true);
    const View = component(
      () => () =>
        many.value ? (
          <>
            <A />
            <span data-extra>and more</span>
          </>
        ) : (
          <B />
        ),
    );
    const view = mount(() => <View />);

    many.value = false;
    many.value = true;
    many.value = false;
    many.value = true;

    expect(view.all('[data-a]')).toHaveLength(1);
    expect(view.all('[data-extra]')).toHaveLength(1);
    expect(view.all('[data-b]')).toHaveLength(0);
    expect(view.text()).toBe('Aand more');
  });
});

describe('a run whose branches are lists and rows', () => {
  it('replaces a keyed list with something that is not one', () => {
    type Row = { id: number; label: string };
    const rows = signal<readonly Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const empty = signal(false);
    const View = component(
      () => () =>
        empty.value ? (
          <p data-none>nothing here</p>
        ) : (
          <ul>
            {rows.value.map((row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>
        ),
    );
    const view = mount(() => <View />);
    expect(view.all('li')).toHaveLength(2);

    empty.value = true;
    expect(view.all('li')).toHaveLength(0);
    expect(view.all('ul')).toHaveLength(0);
    expect(view.all('[data-none]')).toHaveLength(1);

    // And back, because a list rebuilt from nothing is where row identity
    // goes wrong if the rows were kept in a map the branch did not clear.
    empty.value = false;
    expect(view.all('li').map((item) => item.textContent)).toEqual(['one', 'two']);
  });

  it('switches a branch inside a row without disturbing the row beside it', () => {
    type Row = { id: number; label: string };
    const rows = signal<readonly Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const editing = signal(0);
    const Item = component<{ row: Row }>(
      (props) => () =>
        editing.value === props.row.id ? (
          <li data-editing>
            <input value={props.row.label} />
          </li>
        ) : (
          <li>{props.row.label}</li>
        ),
    );
    const view = mount(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));
    const untouched = view.all('li')[1];

    editing.value = 1;
    expect(view.all('[data-editing]')).toHaveLength(1);
    expect(view.all('input')).toHaveLength(1);
    // The other row is the element it was: a run inside one row must not
    // reach the rows beside it.
    expect(view.all('li')[1]).toBe(untouched);

    editing.value = 0;
    expect(view.all('input')).toHaveLength(0);
    expect(view.all('li').map((item) => item.textContent)).toEqual(['one', 'two']);
  });

  it('nests a run inside a run', () => {
    const outer = signal(true);
    const inner = signal(true);
    const Inner = component(() => () => (inner.value ? <b data-in>in</b> : <i data-out>out</i>));
    const View = component(
      () => () =>
        outer.value ? (
          <section>
            <Inner />
          </section>
        ) : (
          <p data-gone>gone</p>
        ),
    );
    const view = mount(() => <View />);
    expect(view.all('[data-in]')).toHaveLength(1);

    inner.value = false;
    expect(view.all('[data-out]')).toHaveLength(1);
    expect(view.all('[data-in]')).toHaveLength(0);

    // The outer run leaves, taking the inner one with it, and comes back.
    outer.value = false;
    expect(view.all('[data-out]')).toHaveLength(0);
    expect(view.all('[data-gone]')).toHaveLength(1);

    outer.value = true;
    expect(view.all('section')).toHaveLength(1);
    expect(view.all('[data-gone]')).toHaveLength(0);
    expect(view.all('[data-in]').length + view.all('[data-out]').length).toBe(1);
  });
});
