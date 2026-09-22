/**
 * What a run says to the children of a child it keeps.
 *
 * A component inside a run is made once and handed back on every run, so it
 * keeps its instance and its place. Anything the run gives it therefore has
 * to arrive as a value that is written again, not as a binding belonging to
 * one call of the run — which props already did, through `cell`, and children
 * did not: they closed over the locals of the run that made them and showed
 * whatever those were the first time, for ever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, signal, type View } from '@firsthandjs/dom';

afterEach(cleanup);

type BoxProps = { readonly label?: string; readonly children?: View };

/*
 * The cast is a types-only gap, not a runtime one: `ReadonlyProps` descends
 * into `View`'s dynamic-child member, which carries an owner, and a deeply
 * readonly owner is no longer one. The same note stands in the server
 * fixtures and in `docs/reference/dom.md`.
 */
const Box = component<BoxProps>((props) => (
  <section>
    <b>{props.label ?? ''}</b>
    {props.children as View}
  </section>
));

describe('a run local given to a component', () => {
  it('follows the run as a prop', () => {
    const count = signal(0);
    const Panel = component(() => () => {
      const n = `n=${String(count.value)}`;
      return <Box label={n} />;
    });
    const view = mount(() => <Panel />);

    expect(view.text()).toContain('n=0');
    count.value = 1;
    expect(view.text()).toContain('n=1');
  });

  it('follows the run as a child', () => {
    const count = signal(0);
    const Panel = component(() => () => {
      const n = `n=${String(count.value)}`;
      return <Box>{n}</Box>;
    });
    const view = mount(() => <Panel />);

    expect(view.text()).toContain('n=0');
    count.value = 1;
    expect(view.text()).toContain('n=1');
  });

  it('writes into the child it had, rather than a new one', () => {
    // The point of a cell over a rebuild, and the assertion a fix that
    // rebuilt the child would pass on its text and fail here.
    const count = signal(0);
    const Panel = component(() => () => {
      const n = `n=${String(count.value)}`;
      return <Box>{n}</Box>;
    });
    const view = mount(() => <Panel />);
    const first = view.get('section');

    count.value = 1;
    expect(view.get('section')).toBe(first);
    expect(view.text()).toContain('n=1');
  });

  it('feeds two of them to the same child', () => {
    // One cell per child, numbered per child: with one child a mistake in the
    // numbering is invisible.
    const count = signal(0);
    const Panel = component(() => () => {
      const a = `a=${String(count.value)}`;
      const b = `b=${String(count.value * 2)}`;
      return (
        <Box>
          {a}
          {b}
        </Box>
      );
    });
    const view = mount(() => <Panel />);

    expect(view.text()).toContain('a=0');
    expect(view.text()).toContain('b=0');

    count.value = 3;
    expect(view.text()).toContain('a=3');
    expect(view.text()).toContain('b=6');
  });

  it('chooses again when the choice is the run local', () => {
    // The shape that made this worth finding: a view with four states, where
    // the state is read in a statement and the markup below is a component.
    const status = signal('loading');
    const Panel = component(() => () => {
      const failed = status.value === 'error';
      return <Box>{failed ? <p>failed</p> : <ul>waiting</ul>}</Box>;
    });
    const view = mount(() => <Panel />);

    expect(view.all('ul')).toHaveLength(1);
    expect(view.all('p')).toHaveLength(0);

    status.value = 'error';
    expect(view.all('ul')).toHaveLength(0);
    expect(view.text()).toContain('failed');
  });

  it('keeps the rows of a list it is over', () => {
    type Row = { id: number; label: string };
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const Item = component((props: { row: Row }) => <li>{props.row.label}</li>);
    const Panel = component(() => () => {
      const shown = rows.value.filter((row) => row.label !== '');
      return (
        <Box>
          {shown.map((row) => (
            <Item key={row.id} row={row} />
          ))}
        </Box>
      );
    });
    const view = mount(() => <Panel />);
    const initial = view.all('li');

    expect(initial.map((li) => li.textContent)).toEqual(['one', 'two']);

    // The data is new and the rows are not: the list is made once, and what
    // it is over is read from the run.
    rows.value = [
      { id: 2, label: 'TWO' },
      { id: 1, label: 'one' },
    ];
    const after = view.all('li');
    expect(after.map((li) => li.textContent)).toEqual(['TWO', 'one']);
    expect(after[0]).toBe(initial[1]);
    expect(after[1]).toBe(initial[0]);
  });

  it('leaves a child that is nothing of the run own alone', () => {
    const count = signal(0);
    const runs = vi.fn();
    const Panel = component(() => () => {
      runs();
      const unrelated = 'x';
      return (
        <Box label={unrelated}>
          <b>{count.value}</b>
        </Box>
      );
    });
    const view = mount(() => <Panel />);
    runs.mockClear();

    // The child reads the signal itself, so it is a part of its own and the
    // run does not hear about the change.
    count.value = 1;
    expect(view.text()).toContain('1');
    expect(runs).not.toHaveBeenCalled();
  });
});
