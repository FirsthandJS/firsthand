/**
 * What a row's own parts do when the row goes.
 *
 * A part removes what it inserted when its scope is disposed, because usually
 * nothing else will. A list row is the exception: the reconciler removes its
 * nodes in one go, and everything the row's parts put inside those nodes goes
 * with them. Doing it twice is work with no effect — 15 ms of the 46 ms it
 * took to clear ten thousand rows.
 *
 * It is invisible in the resulting tree, which is exactly why it is asserted
 * here: an optimisation nobody can see is an optimisation that can silently
 * stop happening.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

type Row = { id: number; label: string };

const rows = signal<Row[]>([]);

const Table = component(() => (
  <ul>
    {rows.value.map((row) => (
      <li key={row.id}>
        <span>{row.label}</span>
        <b>{row.id}</b>
      </li>
    ))}
  </ul>
));

const data = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, label: `row ${String(i + 1)}` }));

/** Counts the removals a body performs, whoever performs them. */
function removals(body: () => void): number {
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = Node.prototype.removeChild;
  const spy = vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function (
    this: Node,
    child: Node,
  ): Node {
    count++;
    return original.call(this, child);
  });
  try {
    body();
  } finally {
    spy.mockRestore();
  }
  return count;
}

describe('a row that leaves the list', () => {
  it('is removed once, and its parts do not remove what is inside it', () => {
    rows.value = data(3);
    const view = mount(() => <Table />);
    expect(view.all('li')).toHaveLength(3);

    // Each row holds two parts. Without the excuse this would be three.
    const count = removals(() => {
      rows.value = rows.value.filter((row) => row.id !== 2);
    });
    expect(count).toBe(1);
    expect(view.all('li')).toHaveLength(2);
    expect(view.text()).toBe('row 11row 33');
  });

  it('empties the whole list without touching what is inside the rows', () => {
    rows.value = data(4);
    const view = mount(() => <Table />);

    // Four rows, eight parts inside them. Only the rows are removed — and in
    // a browser not even those, because emptying the parent is one call; an
    // emulated DOM implements that call as a loop, so the four are what this
    // can see. The eight are the point.
    const count = removals(() => {
      rows.value = [];
    });
    expect(count).toBe(4);
    expect(view.all('li')).toHaveLength(0);
  });

  it('still removes what a part owns when the part alone is disposed', () => {
    // Not a row leaving a list: a conditional whose branch is replaced while
    // its parent stays. Here the removal is the only thing that takes the old
    // content off the page, and it has to happen.
    const shown = signal(true);
    const Branch = component(() => <div>{shown.value ? <span>yes</span> : null}</div>);
    const view = mount(() => <Branch />);
    expect(view.all('span')).toHaveLength(1);

    shown.value = false;
    expect(view.all('span')).toHaveLength(0);
  });
});
