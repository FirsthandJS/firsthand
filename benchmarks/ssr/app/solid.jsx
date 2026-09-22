/**
 * The Solid implementation, compiled by `babel-preset-solid` with
 * `generate: 'ssr'` and `hydratable: true`.
 *
 * Hydratable on purpose: this benchmark is about server rendering that a
 * browser then takes over, and Solid's non-hydratable output leaves out the
 * markers that make that possible. Comparing it against markup Firsthand can
 * hydrate would be comparing two different jobs.
 */
import { For } from 'solid-js';

export function Table(props) {
  return (
    <table class="table">
      <tbody>
        <For each={props.rows}>
          {(row) => (
            <tr class={row.id === props.selected ? 'danger' : undefined}>
              <td class="col-md-1">{row.id}</td>
              <td class="col-md-4">
                <a class="lbl" onClick={() => undefined}>
                  {row.label}
                </a>
              </td>
              <td class="col-md-1">
                <a class="remove" onClick={() => undefined}>
                  <span class="glyphicon glyphicon-remove"></span>
                </a>
              </td>
              <td class="col-md-6"></td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
