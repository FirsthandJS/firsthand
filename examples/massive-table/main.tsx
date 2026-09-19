/**
 * 100 000 rows.
 *
 * Every button reports how long the operation took, including the layout it
 * forced — the same measurement the benchmark suite uses. Nothing here is
 * special-cased: it is the ordinary keyed list part that `{rows.map(...)}`
 * compiles to.
 */
import { component, computed, render, signal } from '@firsthandjs/dom';

type Row = { id: number; label: string; value: number };

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

let nextId = 1;
function build(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: nextId++,
      label: `${WORDS[i % WORDS.length]} ${String(i)}`,
      value: i % 997,
    });
  }
  return rows;
}

const rows = signal<Row[]>([]);
const selected = signal(0);
const lastTiming = signal('');
const total = computed(() => rows.value.reduce((sum, row) => sum + row.value, 0));

/**
 * Swaps the second and the second-to-last row.
 *
 * Reads first, then writes: under `noUncheckedIndexedAccess` a read can be
 * `undefined`, and narrowing it once is cheaper to read than casting twice.
 */
function swapEnds(rows: readonly Row[]): Row[] {
  const next = rows.slice();
  const first = next[1];
  const last = next[next.length - 2];
  if (first === undefined || last === undefined) {
    return next;
  }
  next[1] = last;
  next[next.length - 2] = first;
  return next;
}

/** Times an operation the way the benchmark does: including forced layout. */
function timed(name: string, operation: () => void): void {
  const start = performance.now();
  operation();
  void document.body.offsetHeight;
  lastTiming.value = `${name}: ${(performance.now() - start).toFixed(1)} ms`;
}

const RowView = component((props: { row: Row }) => (
  <tr class={props.row.id === selected.value ? 'done' : undefined}>
    <td>{props.row.id}</td>
    <td>
      <a
        href="#"
        onClick={(event) => {
          event.preventDefault();
          selected.value = props.row.id;
        }}
      >
        {props.row.label}
      </a>
    </td>
    <td>{props.row.value}</td>
  </tr>
));

const App = component(() => (
  <>
    <h1>Massive table</h1>
    <p>
      <button
        onClick={() => {
          timed('create 100 000', () => {
            rows.value = build(100_000);
          });
        }}
      >
        create 100 000
      </button>{' '}
      <button
        onClick={() => {
          timed('append 10 000', () => {
            rows.value = rows.value.concat(build(10_000));
          });
        }}
      >
        append 10 000
      </button>{' '}
      <button
        onClick={() => {
          timed('update every 10th', () => {
            rows.value = rows.value.map((row, i) =>
              i % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row,
            );
          });
        }}
      >
        update every 10th
      </button>{' '}
      <button
        onClick={() => {
          timed('reverse', () => {
            rows.value = rows.value.slice().reverse();
          });
        }}
      >
        reverse
      </button>{' '}
      <button
        onClick={() => {
          timed('swap ends', () => {
            rows.value = swapEnds(rows.value);
          });
        }}
      >
        swap ends
      </button>{' '}
      <button
        onClick={() => {
          timed('clear', () => {
            rows.value = [];
          });
        }}
      >
        clear
      </button>
    </p>
    <p>
      {rows.value.length} rows · sum {total.value} · {lastTiming.value}
    </p>
    <table>
      <tbody>
        {rows.value.map((row) => (
          <RowView key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  </>
));

// No container argument and no element lookup: `render` mounts into
// `document.body` by default.
render(() => <App />);
