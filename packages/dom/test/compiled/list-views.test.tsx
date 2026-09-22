/**
 * Keyed rows that are views rather than trees.
 *
 * A component's setup may return a render function, and then what the row is
 * made of is not known when the row is made: it is a part, which runs, and
 * runs again when what it read changes. A keyed list has to place that part,
 * keep track of what it currently has in the document, and move all of it
 * when the row moves.
 *
 * The regression that brought this about: `collect` had no branch for a
 * function, so the row's own source was written into the page as text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, signal } from '@firsthandjs/dom';

afterEach(() => {
  cleanup();
});

type Row = { id: number; label: string };

describe('a keyed row whose setup returns a render function', () => {
  it('renders the view, rather than the function it is written as', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => () => <li>{props.row.label}</li>);
    const App = component(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(host.textContent).not.toContain('=>');
  });

  it('updates in place, without the row being made again', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const setups = vi.fn();
    const Item = component((props: { row: Row }) => {
      setups();
      return () => <li data-id={String(props.row.id)}>{props.row.label}</li>;
    });
    const App = component(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    const initial = [...host.querySelectorAll('li')];
    expect(setups).toHaveBeenCalledTimes(2);

    rows.value = rows.value.map((row) => (row.id === 2 ? { id: 2, label: 'TWO' } : row));
    expect(setups).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('li')[1]).toBe(initial[1]);
    expect(host.querySelectorAll('li')[1]?.textContent).toBe('TWO');
  });

  it('moves everything the row has, not only where the row keeps it', () => {
    // The anchor alone would reorder and leave the content behind, which is
    // the failure this row shape makes possible: what a view row has in the
    // document changes without the list running.
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ]);
    const Item = component((props: { row: Row }) => () => <li>{props.row.label}</li>);
    const App = component(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    const initial = [...host.querySelectorAll('li')];

    rows.value = [...rows.value].reverse();
    const reversed = [...host.querySelectorAll('li')];
    expect(reversed.map((li) => li.textContent)).toEqual(['three', 'two', 'one']);
    expect(reversed[0]).toBe(initial[2]);
    expect(reversed[2]).toBe(initial[0]);
  });

  it('takes its rows away with it', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => () => <li>{props.row.label}</li>);
    const App = component(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    rows.value = [{ id: 2, label: 'two' }];
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['two']);

    rows.value = [];
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.querySelector('ul')?.textContent).toBe('');
  });

  it('changes with state of its own, without the list running', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const setups = vi.fn();
    const passes = vi.fn();
    const open = signal(false);
    const Item = component((props: { row: Row }) => {
      setups();
      return () => <li>{open.value ? `${props.row.label}!` : props.row.label}</li>;
    });
    const App = component(() => (
      <ul>
        {rows.value.map((row) => {
          passes();
          return <Item key={row.id} row={row} />;
        })}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    const initial = [...host.querySelectorAll('li')];
    passes.mockClear();

    open.value = true;
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one!', 'two!']);
    // Inside the rows, and nowhere else: the list did not run, the setups did
    // not run again, and the elements are the ones that were there.
    expect(passes).not.toHaveBeenCalled();
    expect(setups).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('li')[0]).toBe(initial[0]);
    expect(host.querySelectorAll('li')[1]).toBe(initial[1]);
  });

  it('is a row even when what it returns changes shape', () => {
    const wide = signal(true);
    const rows = signal<Row[]>([{ id: 1, label: 'one' }]);
    const Item = component(
      (props: { row: Row }) => () =>
        wide.value ? <li data-wide>{props.row.label}</li> : <li data-narrow>{props.row.id}</li>,
    );
    const App = component(() => (
      <ul>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </ul>
    ));

    const view = mount(() => <App />);
    const host = view.container;
    expect(host.querySelector('li')?.hasAttribute('data-wide')).toBe(true);

    wide.value = false;
    expect(host.querySelector('li')?.hasAttribute('data-narrow')).toBe(true);
    expect(host.querySelectorAll('li')).toHaveLength(1);
  });
});

describe('a keyed row that is a fragment', () => {
  it('places and binds the parts the fragment is made of', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => (
      <>
        <b>{props.row.label}</b>
        <i>{props.row.id}</i>
      </>
    ));
    const view = mount(() => (
      <p>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </p>
    ));

    expect(view.container.textContent).toBe('one1two2');

    rows.value = [...rows.value].reverse();
    expect(view.container.textContent).toBe('two2one1');
  });

  it('places a part the fragment carries an anchor for', () => {
    // A fragment's dynamic child is compiled to a part, because an array has
    // no element to bind against. As a row it arrives here already anchored
    // and already owned, and only has to be placed like the rest.
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => (
      <>
        {props.row.label}
        <i>!</i>
      </>
    ));
    const view = mount(() => (
      <p>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </p>
    ));

    expect(view.container.textContent).toBe('one!two!');

    rows.value = [...rows.value].reverse();
    expect(view.container.textContent).toBe('two!one!');
  });

  it('is a row even when it has nothing to show', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const shown = signal(true);
    const Item = component(
      (props: { row: Row }) => () => (shown.value ? <b>{props.row.label}</b> : null),
    );
    const view = mount(() => (
      <p>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </p>
    ));

    expect(view.container.textContent).toBe('onetwo');

    // Nothing in the document, and still a row: it comes back where it was.
    shown.value = false;
    expect(view.container.textContent).toBe('');
    rows.value = [...rows.value].reverse();
    shown.value = true;
    expect(view.container.textContent).toBe('twoone');
  });
});

describe('a keyed row that is not markup at all', () => {
  it('is written the way the platform writes it', () => {
    // Not a shape anybody means to write — most often a signal read without
    // `.value` — and it renders as text rather than breaking the list around
    // it. Development says so; this is what production does.
    const rows = signal<Row[]>([{ id: 1, label: 'one' }]);
    const Item = component((props: { row: Row }) => props.row as unknown as never);
    const view = mount(() => (
      <p>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </p>
    ));

    expect(view.container.textContent).toBe('[object Object]');
  });
});

describe('a keyed row that is a view of several nodes', () => {
  it('keeps all of them, and moves all of them', () => {
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => () => (
      <>
        <b>{props.row.label}</b>
        <i>{props.row.id}</i>
      </>
    ));
    const view = mount(() => (
      <p>
        {rows.value.map((row) => (
          <Item key={row.id} row={row} />
        ))}
      </p>
    ));

    expect(view.container.textContent).toBe('one1two2');

    rows.value = [...rows.value].reverse();
    expect(view.container.textContent).toBe('two2one1');

    rows.value = [{ id: 2, label: 'two' }];
    expect(view.container.textContent).toBe('two2');
  });
});

describe('a keyed list of both at once', () => {
  it('holds rows that are views beside rows that are trees', () => {
    // One component, deciding per row: a setup may hand back markup or a
    // render function, and which it is can depend on the props. So a list can
    // hold both, and what each row is made of has to be asked of the row.
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ]);
    const open = signal(false);
    const Item = component((props: { row: Row }) =>
      props.row.id === 2 ? (
        () => <li>{open.value ? `${props.row.label}!` : props.row.label}</li>
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
    const host = view.container;
    const initial = [...host.querySelectorAll('li')];

    expect(initial.map((li) => li.textContent)).toEqual(['one', 'two', 'three']);

    // The view row writes; the trees around it are untouched.
    open.value = true;
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'one',
      'two!',
      'three',
    ]);
    expect(host.querySelectorAll('li')[0]).toBe(initial[0]);

    // And a reorder moves both kinds, by the nodes each of them has.
    rows.value = [...rows.value].reverse();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'three',
      'two!',
      'one',
    ]);
    expect(host.querySelectorAll('li')[0]).toBe(initial[2]);
    expect(host.querySelectorAll('li')[2]).toBe(initial[0]);
  });
});
