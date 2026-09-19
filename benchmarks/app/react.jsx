/**
 * The React implementation.
 *
 * Idiomatic React 19: state in components, memoised rows, keys on lists,
 * `useContext` for context, `flushSync` so that each measured operation has
 * actually reached the DOM when the clock stops. It must produce byte-identical
 * DOM to the Firsthand implementation; the runner asserts that before it times
 * anything.
 */
import { createContext, createElement as h, memo, useCallback, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { createDataFactory } from './data.js';

// ---------------------------------------------------------------------------
// Table: the row-list scenarios
// ---------------------------------------------------------------------------

const Row = memo(function Row({ row, selected, onSelect, onRemove }) {
  return h(
    'tr',
    { className: selected ? 'danger' : undefined },
    h('td', { className: 'col-md-1' }, row.id),
    h(
      'td',
      { className: 'col-md-4' },
      h('a', { className: 'lbl', onClick: () => onSelect(row.id) }, row.label),
    ),
    h(
      'td',
      { className: 'col-md-1' },
      h(
        'a',
        { className: 'remove', onClick: () => onRemove(row.id) },
        h('span', { className: 'glyphicon glyphicon-remove' }),
      ),
    ),
    h('td', { className: 'col-md-6' }),
  );
});

const Compact = memo(function Compact({ row }) {
  return h('tr', null, h('td', { className: 'col-md-1' }, row.id));
});

let table;

function Table() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(0);
  const [compact, setCompact] = useState(false);

  const onSelect = useCallback((id) => setSelected(id), []);
  const onRemove = useCallback(
    (id) => setRows((current) => current.filter((r) => r.id !== id)),
    [],
  );

  table = { setRows, setSelected, setCompact, rows };

  return h(
    'table',
    { className: 'table' },
    h(
      'tbody',
      null,
      compact
        ? rows.map((row) => h(Compact, { key: row.id, row }))
        : rows.map((row) =>
            h(Row, { key: row.id, row, selected: row.id === selected, onSelect, onRemove }),
          ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Deep tree: one component per level, a leaf at the bottom
// ---------------------------------------------------------------------------

let deep;

const Branch = memo(function Branch({ depth, label }) {
  if (depth === 0) {
    return h('span', { className: 'leaf' }, label);
  }
  return h('div', { className: 'level' }, h(Branch, { depth: depth - 1, label }));
});

function Deep() {
  const [label, setLabel] = useState('start');
  deep = { setLabel };
  return h(
    'div',
    { id: 'deep' },
    Array.from({ length: 20 }, (_, i) => h(Branch, { key: i, depth: 25, label })),
  );
}

// ---------------------------------------------------------------------------
// Context: one provider, many consumers
// ---------------------------------------------------------------------------

const ThemeContext = createContext('light');

const Consumer = memo(function Consumer({ index }) {
  const theme = useContext(ThemeContext);
  return h('li', { className: 'consumer' }, `${index}:${theme}`);
});

let consumers;

function Consumers({ count }) {
  const [theme, setTheme] = useState('light');
  consumers = { setTheme };
  return h(
    ThemeContext.Provider,
    { value: theme },
    h(
      'ul',
      { id: 'consumers' },
      Array.from({ length: count }, (_, i) => h(Consumer, { key: i, index: i })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Portal: content rendered into a foreign container
// ---------------------------------------------------------------------------

let portalState;

function WithPortal() {
  const [value, setValue] = useState(0);
  portalState = { setValue };
  const target = document.getElementById('portal-target');
  return h(
    'div',
    { id: 'portal-host' },
    target === null
      ? null
      : createPortal(
          h('div', { id: 'portal-body' }, h('span', { className: 'portal-value' }, value)),
          target,
        ),
  );
}

// ---------------------------------------------------------------------------
// Input: a controlled field, for event-to-DOM latency
// ---------------------------------------------------------------------------

function Input() {
  const [typed, setTyped] = useState('');
  return h(
    'div',
    { id: 'input-host' },
    // Uncontrolled, to match the Firsthand implementation: see the comment there.
    h('input', {
      id: 'field',
      onChange: (event) => {
        flushSync(() => setTyped(event.target.value));
      },
    }),
    h('p', { id: 'echo' }, typed),
  );
}

// ---------------------------------------------------------------------------
// Counter: rapid updates
// ---------------------------------------------------------------------------

let counter;

function Counter() {
  const [value, setValue] = useState(0);
  counter = { setValue };
  return h('p', { id: 'counter' }, value);
}

// ---------------------------------------------------------------------------

const MODES = {
  table: () => h(Table),
  deep: () => h(Deep),
  counter: () => h(Counter),
  context: (argument) => h(Consumers, { count: argument }),
  portal: () => h(WithPortal),
  input: () => h(Input),
};

export function createReactImplementation(container, seed, mode = 'table', argument = 0) {
  const nextData = createDataFactory(seed);
  const root = createRoot(container);
  flushSync(() => root.render(MODES[mode](argument)));

  const apply = (update) => {
    flushSync(() => {
      table.setRows(update(table.rows));
    });
  };

  return {
    name: 'react',
    run(operation, argument) {
      switch (operation) {
        case 'create':
          apply(() => nextData(argument));
          return;
        case 'append':
          apply((rows) => rows.concat(nextData(argument)));
          return;
        case 'prepend':
          apply((rows) => nextData(argument).concat(rows));
          return;
        case 'updateEveryTenth':
          apply((rows) =>
            rows.map((row, i) => (i % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row)),
          );
          return;
        case 'updateOne':
          apply((rows) =>
            rows.map((row, i) => (i === argument ? { ...row, label: `${row.label} !!!` } : row)),
          );
          return;
        case 'select':
          flushSync(() => {
            table.setSelected(table.rows[argument].id);
          });
          return;
        case 'remove':
          apply((rows) => rows.filter((_, i) => i !== argument));
          return;
        case 'swap': {
          apply((rows) => {
            const next = rows.slice();
            const first = next[1];
            next[1] = next[rows.length - 2];
            next[rows.length - 2] = first;
            return next;
          });
          return;
        }
        case 'reverse':
          apply((rows) => rows.slice().reverse());
          return;
        case 'clear':
          apply(() => []);
          return;
        case 'toggleBranch':
          flushSync(() => {
            table.setCompact((current) => !current);
          });
          return;
        case 'portalUpdate':
          flushSync(() => {
            portalState.setValue((value) => value + 1);
          });
          return;
        case 'type': {
          // The same path a user takes: a real input event on the field.
          // React listens for `input` through its own delegation and calls
          // `onChange`, so this exercises the same code an application does.
          const field = document.getElementById('field');
          if (field !== null) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(field, `typed ${argument}`);
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
          return;
        }
        case 'deepUpdate':
          flushSync(() => {
            deep.setLabel((current) => (current === 'start' ? 'changed' : 'start'));
          });
          return;
        case 'contextChange':
          flushSync(() => {
            consumers.setTheme((current) => (current === 'light' ? 'dark' : 'light'));
          });
          return;
        case 'rapidUnbatched':
          // One commit per write: the honest counterpart to n unbatched signal
          // writes in Firsthand.
          for (let i = 0; i < argument; i++) {
            flushSync(() => {
              counter.setValue((value) => value + 1);
            });
          }
          return;
        case 'rapidBatched':
          // One commit for all of them, like Firsthand's batch().
          flushSync(() => {
            for (let i = 0; i < argument; i++) {
              counter.setValue((value) => value + 1);
            }
          });
          return;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    },
    dispose() {
      root.unmount();
    },
  };
}
