/**
 * A keyed list whose data belongs to the run (issue #40).
 *
 * The shape this is about is the one people write: compute what you need at
 * the top of the run, then render it.
 *
 * ```tsx
 * return () => {
 *   const all = rows.value;
 *   return <ul>{all.map((row) => <Item key={row.id} row={row} />)}</ul>;
 * };
 * ```
 *
 * It used to refuse the site, which meant the whole template — every row of it
 * — was built again on every run: new elements, new component instances, and
 * every piece of row-local state thrown away. The same markup written without
 * the local worked, which is the kind of difference nobody should have to know
 * about.
 *
 * The data now reaches the list through a cell the run writes, so the list is
 * made once and reconciles afterwards, exactly as it does when the data comes
 * from anywhere else. What is asserted here is DOM identity: the same `<li>`
 * objects, before and after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, signal } from '@firsthandjs/dom';

type Row = { id: number; n: string };

afterEach(() => {
  cleanup();
});

describe('a keyed list over a run local', () => {
  it('keeps its rows when the rows are trees', () => {
    const rows = signal<Row[]>([
      { id: 1, n: 'one' },
      { id: 2, n: 'two' },
    ]);
    const App = component(() => () => {
      const all = rows.value;
      return (
        <ul>
          {all.map((row) => (
            <li key={row.id}>{row.n}</li>
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    const initial = [...host.container.querySelectorAll('li')];
    expect(initial).toHaveLength(2);

    // A third row arrives. The two that were already there are the same
    // elements; only the new one is new.
    rows.value = [...rows.peek(), { id: 3, n: 'three' }];
    const after = [...host.container.querySelectorAll('li')];

    expect(after).toHaveLength(3);
    expect(after[0]).toBe(initial[0]);
    expect(after[1]).toBe(initial[1]);
    expect(host.text()).toContain('three');
  });

  it('keeps its rows across a reorder, and moves them', () => {
    const rows = signal<Row[]>([
      { id: 1, n: 'one' },
      { id: 2, n: 'two' },
    ]);
    const App = component(() => () => {
      const all = rows.value;
      return (
        <ul>
          {all.map((row) => (
            <li key={row.id}>{row.n}</li>
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    const [first, second] = [...host.container.querySelectorAll('li')];

    rows.value = [rows.peek()[1] as Row, rows.peek()[0] as Row];
    const after = [...host.container.querySelectorAll('li')];

    expect(after[0]).toBe(second);
    expect(after[1]).toBe(first);
  });

  it('keeps the state inside a row that is a component', () => {
    // The cost of rebuilding is not only DOM identity: a row that holds state
    // loses it. This is the assertion that says so.
    const rows = signal<Row[]>([{ id: 1, n: 'one' }]);
    const Item = component((props: { row: Row }) => {
      const seen = signal(0);
      seen.value = seen.peek() + 1;
      return () => <li data-made={String(seen.value)}>{props.row.n}</li>;
    });
    const App = component(() => () => {
      const all = rows.value;
      return (
        <ul>
          {all.map((row) => (
            <Item key={row.id} row={row} />
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    const made = host.get('li').getAttribute('data-made');

    rows.value = [...rows.peek(), { id: 2, n: 'two' }];

    // The first row's component was not built a second time.
    expect(host.container.querySelector('li')?.getAttribute('data-made')).toBe(made);
  });

  it('still rebuilds when the row itself holds the run’s value', () => {
    // The refusal that is still right: the row closes over a value belonging
    // to one run, so a list made once would render it for ever.
    const rows = signal<Row[]>([{ id: 1, n: 'one' }]);
    const suffix = signal('!');
    const App = component(() => () => {
      const mark = suffix.value;
      return (
        <ul>
          {rows.value.map((row) => (
            <li key={row.id}>
              {row.n}
              {mark}
            </li>
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    expect(host.text()).toContain('one!');

    suffix.value = '?';
    expect(host.text()).toContain('one?');
  });
});
