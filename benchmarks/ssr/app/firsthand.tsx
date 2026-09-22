/**
 * The document every framework in this benchmark renders.
 *
 * A table of rows, each with an id, a link, a class that depends on state and
 * a handler — the shape of a list page, and the shape the client benchmark
 * already uses. The handler is here on purpose: a server cannot write one, and
 * how cheaply a framework decides not to write it is part of what is being
 * measured.
 */
import { component } from '@firsthandjs/dom';
import type { Row } from './rows.js';

const RowView = component((props: { row: Row; selected: number }) => (
  <tr class={props.row.id === props.selected ? 'danger' : undefined}>
    <td class="col-md-1">{props.row.id}</td>
    <td class="col-md-4">
      <a class="lbl" onClick={() => undefined}>
        {props.row.label}
      </a>
    </td>
    <td class="col-md-1">
      <a class="remove" onClick={() => undefined}>
        <span class="glyphicon glyphicon-remove"></span>
      </a>
    </td>
    <td class="col-md-6"></td>
  </tr>
));

export const Table = component((props: { rows: readonly Row[]; selected: number }) => (
  <table class="table">
    <tbody>
      {props.rows.map((row) => (
        <RowView key={row.id} row={row} selected={props.selected} />
      ))}
    </tbody>
  </table>
));
