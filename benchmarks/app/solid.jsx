/**
 * The Solid implementation.
 *
 * Idiomatic Solid 1.9: a store for the row data so that a label change is a
 * fine-grained write rather than a new array, `<For>` for the keyed list,
 * `createContext`/`useContext` for context, and `<Portal>` for the portal
 * scenario. Compiled by `babel-preset-solid`, which is how Solid is meant to
 * be built — its compiler is not an optional extra.
 *
 * Each framework here is written the way its own documentation writes it. What
 * is held identical across all of them is the **data**, the **operations** and
 * the **resulting DOM**, which the runner asserts before it times anything.
 */
import { For, Show, batch, createContext, createSignal, useContext } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Portal, render } from 'solid-js/web';
import { createDataFactory } from './data.js';

// ---------------------------------------------------------------------------
// Table: the row-list scenarios
// ---------------------------------------------------------------------------

let table;

function Table() {
  const [state, setState] = createStore({ rows: [], selected: 0, compact: false });
  table = { state, setState };

  return (
    <table class="table">
      <tbody>
        {/* The branch belongs where it can be re-evaluated: a `<For>` callback
            runs once per row, so a ternary inside it would be decided once. */}
        <Show
          when={state.compact}
          fallback={
            <For each={state.rows}>
              {(row) => (
                <tr class={row.id === state.selected ? 'danger' : undefined}>
                  <td class="col-md-1">{row.id}</td>
                  <td class="col-md-4">
                    <a
                      class="lbl"
                      onClick={() => {
                        setState('selected', row.id);
                      }}
                    >
                      {row.label}
                    </a>
                  </td>
                  <td class="col-md-1">
                    <a
                      class="remove"
                      onClick={() => {
                        setState(
                          'rows',
                          state.rows.filter((one) => one.id !== row.id),
                        );
                      }}
                    >
                      <span class="glyphicon glyphicon-remove"></span>
                    </a>
                  </td>
                  <td class="col-md-6"></td>
                </tr>
              )}
            </For>
          }
        >
          <For each={state.rows}>
            {(row) => (
              <tr>
                <td class="col-md-1">{row.id}</td>
              </tr>
            )}
          </For>
        </Show>
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Deep tree: one component per level, a leaf at the bottom
// ---------------------------------------------------------------------------

const [deepLabel, setDeepLabel] = createSignal('start');

function Branch(props) {
  return props.depth === 0 ? (
    <span class="leaf">{deepLabel()}</span>
  ) : (
    <div class="level">
      <Branch depth={props.depth - 1} />
    </div>
  );
}

function Deep() {
  return (
    <div id="deep">
      <For each={Array.from({ length: 20 }, (_, i) => i)}>{() => <Branch depth={25} />}</For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context: one provider, many consumers
// ---------------------------------------------------------------------------

const ThemeContext = createContext();
const [theme, setTheme] = createSignal('light');

function Consumer(props) {
  const current = useContext(ThemeContext);
  return <li class="consumer">{`${String(props.index)}:${current()}`}</li>;
}

function Consumers(props) {
  return (
    <ThemeContext.Provider value={theme}>
      <ul id="consumers">
        <For each={Array.from({ length: props.count }, (_, i) => i)}>
          {(index) => <Consumer index={index} />}
        </For>
      </ul>
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Portal: content rendered into a foreign container
// ---------------------------------------------------------------------------

const [portalValue, setPortalValue] = createSignal(0);

function WithPortal() {
  const target = document.getElementById('portal-target');
  return (
    <div id="portal-host">
      <Portal mount={target}>
        <div id="portal-body">
          <span class="portal-value">{portalValue()}</span>
        </div>
      </Portal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input: event-to-DOM latency
// ---------------------------------------------------------------------------

const [typed, setTyped] = createSignal('');

function Input() {
  return (
    <div id="input-host">
      <input
        id="field"
        onInput={(event) => {
          setTyped(event.currentTarget.value);
        }}
      />
      <p id="echo">{typed()}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counter: rapid updates
// ---------------------------------------------------------------------------

const [counter, setCounter] = createSignal(0);

function Counter() {
  return <p id="counter">{counter()}</p>;
}

// ---------------------------------------------------------------------------

const MODES = {
  table: () => <Table />,
  deep: () => <Deep />,
  counter: () => <Counter />,
  context: (argument) => <Consumers count={argument} />,
  portal: () => <WithPortal />,
  input: () => <Input />,
};

export function createSolidImplementation(container, seed, mode = 'table', argument = 0) {
  const nextData = createDataFactory(seed);
  setDeepLabel('start');
  setTheme('light');
  setCounter(0);
  setPortalValue(0);
  setTyped('');

  const dispose = render(() => MODES[mode](argument), container);

  return {
    name: 'solid',
    run(operation, value) {
      switch (operation) {
        case 'create':
          table.setState('rows', nextData(value));
          return;
        case 'append':
          table.setState('rows', (rows) => rows.concat(nextData(value)));
          return;
        case 'prepend':
          table.setState('rows', (rows) => nextData(value).concat(rows));
          return;
        case 'updateEveryTenth':
          // A store write per row, which is what makes this fine-grained in
          // Solid: the label's text node is written and nothing else moves.
          table.setState(
            produce((state) => {
              for (let i = 0; i < state.rows.length; i += 10) {
                state.rows[i].label += ' !!!';
              }
            }),
          );
          return;
        case 'updateOne':
          table.setState('rows', value, 'label', (label) => `${label} !!!`);
          return;
        case 'select':
          table.setState('selected', table.state.rows[value].id);
          return;
        case 'remove':
          table.setState('rows', (rows) => rows.filter((_, i) => i !== value));
          return;
        case 'swap':
          table.setState('rows', (rows) => {
            const next = rows.slice();
            const first = next[1];
            next[1] = next[rows.length - 2];
            next[rows.length - 2] = first;
            return next;
          });
          return;
        case 'reverse':
          table.setState('rows', (rows) => rows.slice().reverse());
          return;
        case 'clear':
          table.setState('rows', []);
          return;
        case 'toggleBranch':
          table.setState('compact', (current) => !current);
          return;
        case 'portalUpdate':
          setPortalValue((current) => current + 1);
          return;
        case 'type': {
          const field = document.getElementById('field');
          if (field !== null) {
            field.value = `typed ${String(value)}`;
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
          return;
        }
        case 'deepUpdate':
          setDeepLabel((current) => (current === 'start' ? 'changed' : 'start'));
          return;
        case 'contextChange':
          setTheme((current) => (current === 'light' ? 'dark' : 'light'));
          return;
        case 'rapidUnbatched':
          for (let i = 0; i < value; i++) {
            setCounter((current) => current + 1);
          }
          return;
        case 'rapidBatched':
          // Solid batches synchronously inside an effect boundary; `batch` is
          // the documented way to say so explicitly.
          batch(() => {
            for (let i = 0; i < value; i++) {
              setCounter((current) => current + 1);
            }
          });
          return;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    },
    dispose,
  };
}
