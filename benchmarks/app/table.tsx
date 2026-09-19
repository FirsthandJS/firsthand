/**
 * The row table, shared by every benchmark that measures one.
 *
 * This file is imported unchanged by the repository's own benchmark
 * (`firsthand.tsx`) and by the js-framework-benchmark implementation
 * (`../js-framework-benchmark/src/main.tsx`). The surrounding pages differ,
 * because the upstream harness dictates its own buttons and ids — but the
 * component, the keyed list and every operation are the same code, and
 * `npm run check:benchmark-shared` fails if that stops being true.
 *
 * It uses the published entry points and the published compiler. There is no
 * benchmark-only runtime and no privileged API (ARCHITECTURE section 1.1).
 */
import { component, signal } from '@firsthandjs/dom';
import { createDataFactory } from './data.js';

export type Row = { id: number; label: string };

export const rows = signal<Row[]>([]);
export const selected = signal(0);
/** Switches the row component, for the conditional-branch scenario. */
export const compact = signal(false);

const select = (id: number): void => {
  selected.value = id;
};
const remove = (id: number): void => {
  rows.value = rows.value.filter((row) => row.id !== id);
};

// `props.row` is a live read: the compiler turns the map callback's parameter
// into a reactive cell and the prop into an accessor, so a row whose data
// changes updates in place without re-running this function.
const RowView = component((props: { row: Row }) => (
  <tr class={props.row.id === selected.value ? 'danger' : undefined}>
    <td class="col-md-1">{props.row.id}</td>
    <td class="col-md-4">
      <a
        class="lbl"
        onClick={() => {
          select(props.row.id);
        }}
      >
        {props.row.label}
      </a>
    </td>
    <td class="col-md-1">
      <a
        class="remove"
        onClick={() => {
          remove(props.row.id);
        }}
      >
        <span class="glyphicon glyphicon-remove"></span>
      </a>
    </td>
    <td class="col-md-6"></td>
  </tr>
));

const CompactView = component((props: { row: Row }) => (
  <tr>
    <td class="col-md-1">{props.row.id}</td>
  </tr>
));

export const Table = component(() => (
  <table class="table">
    <tbody>
      {compact.value
        ? rows.value.map((row) => <CompactView key={row.id} row={row} />)
        : rows.value.map((row) => <RowView key={row.id} row={row} />)}
    </tbody>
  </table>
));

/**
 * Every operation the benchmarks perform on the table.
 *
 * One definition, so the repository's benchmark and the independent one cannot
 * measure subtly different work.
 */
export function createTableOperations(seed: number): (operation: string, argument: number) => void {
  const nextData = createDataFactory(seed);
  rows.value = [];
  selected.value = 0;
  compact.value = false;

  return (operation: string, argument: number): void => {
    switch (operation) {
      case 'create':
        rows.value = nextData(argument);
        return;
      case 'append':
        rows.value = rows.value.concat(nextData(argument));
        return;
      case 'prepend':
        rows.value = nextData(argument).concat(rows.value);
        return;
      case 'updateEveryTenth':
        rows.value = rows.value.map((row, i) =>
          i % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row,
        );
        return;
      case 'updateOne':
        rows.value = rows.value.map((row, i) =>
          i === argument ? { ...row, label: `${row.label} !!!` } : row,
        );
        return;
      case 'select':
        selected.value = (rows.value[argument] as Row).id;
        return;
      case 'remove':
        rows.value = rows.value.filter((_, i) => i !== argument);
        return;
      case 'swap': {
        const next = rows.value.slice();
        const first = next[1];
        const last = next[next.length - 2];
        if (first !== undefined && last !== undefined) {
          next[1] = last;
          next[next.length - 2] = first;
        }
        rows.value = next;
        return;
      }
      case 'reverse':
        rows.value = rows.value.slice().reverse();
        return;
      case 'clear':
        rows.value = [];
        return;
      case 'toggleBranch':
        compact.value = !compact.value;
        return;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  };
}
