/**
 * The React implementation, for `react-dom/server`.
 *
 * Plain function components, which is how React is written and what
 * `renderToString` is given.
 */
import { createElement as h } from 'react';

function Row({ row, selected }) {
  return h('tr', { className: row.id === selected ? 'danger' : undefined }, [
    h('td', { className: 'col-md-1', key: 'a' }, row.id),
    h(
      'td',
      { className: 'col-md-4', key: 'b' },
      h('a', { className: 'lbl', onClick: () => undefined }, row.label),
    ),
    h(
      'td',
      { className: 'col-md-1', key: 'c' },
      h(
        'a',
        { className: 'remove', onClick: () => undefined },
        h('span', { className: 'glyphicon glyphicon-remove' }),
      ),
    ),
    h('td', { className: 'col-md-6', key: 'd' }),
  ]);
}

export function Table({ rows, selected }) {
  return h(
    'table',
    { className: 'table' },
    h(
      'tbody',
      null,
      rows.map((row) => h(Row, { key: row.id, row, selected })),
    ),
  );
}
