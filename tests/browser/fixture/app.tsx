/**
 * The fixture the cross-engine tests drive.
 *
 * It is compiled by the published compiler and uses the published entry
 * points, so what Chromium, Firefox and WebKit execute is the real framework —
 * not a test double. Counters are exposed on `globalThis.probe` so the tests can
 * assert things that are invisible in the DOM, such as how often a component
 * function ran.
 */
import {
  component,
  createContext,
  defineElement,
  onCleanup,
  portal,
  provide,
  render,
  signal,
  useContext,
  type Dispose,
} from '@firsthandjs/dom';

type Row = { id: number; label: string };

const probe = {
  setupRuns: 0,
  rowSetupRuns: 0,
  cleanups: 0,
  handlerCalls: 0,
};

const count = signal(0);
const rows = signal<Row[]>([
  { id: 1, label: 'one' },
  { id: 2, label: 'two' },
  { id: 3, label: 'three' },
]);
const showModal = signal(false);
const theme = signal({ mode: 'light' });

const ThemeContext = createContext<{ mode: string }>();

const RowView = component((props: { row: Row }) => {
  probe.rowSetupRuns++;
  onCleanup(() => {
    probe.cleanups++;
  });
  return (
    <li data-id={String(props.row.id)} class="row">
      {props.row.label}
    </li>
  );
});

const Modal = component(() => {
  const current = useContext(ThemeContext);
  return <div id="modal">modal sees {current.value.mode}</div>;
});

const Shadowed = component(
  () => {
    const span = document.createElement('span');
    span.id = 'in-shadow';
    span.textContent = 'shadow content';
    return span;
  },
  { shadow: true },
);
defineElement(Shadowed as never, 'firsthand-shadowed');

const App = component(() => {
  probe.setupRuns++;
  provide(ThemeContext, theme);

  return (
    <main>
      <button
        id="increment"
        class={count.value > 2 ? 'high' : 'low'}
        disabled={count.value >= 5}
        onClick={() => {
          probe.handlerCalls++;
          count.value++;
        }}
      >
        count: {count.value}
      </button>
      <p id="doubled" style={{ opacity: count.value > 0 ? 1 : 0 }}>
        doubled: {count.value * 2}
      </p>
      {count.value > 2 ? <strong id="large">large</strong> : <em id="small">small</em>}
      <ul id="rows">
        {rows.value.map((row) => (
          <RowView key={row.id} row={row} />
        ))}
      </ul>
      <firsthand-shadowed id="host"></firsthand-shadowed>
      {showModal.value && portal(<Modal />, document.body)}
    </main>
  );
});

let dispose: Dispose | null = render(() => <App />, document.getElementById('root') as HTMLElement);

const actions: Record<string, (value?: unknown) => unknown> = {
  reverse: () => {
    rows.value = [...rows.value].reverse();
  },
  renameFirst: () => {
    rows.value = rows.value.map((row, i) => (i === 0 ? { ...row, label: 'renamed' } : row));
  },
  removeMiddle: () => {
    rows.value = rows.value.filter((row) => row.id !== 2);
  },
  addMany: (n) => {
    const start = rows.value.length + 1;
    rows.value = rows.value.concat(
      Array.from({ length: n as number }, (_, i) => ({
        id: start + i + 100,
        label: `row ${String(start + i)}`,
      })),
    );
  },
  clear: () => {
    rows.value = [];
  },
  toggleTheme: () => {
    theme.value = { mode: theme.value.mode === 'light' ? 'dark' : 'light' };
  },
  openModal: () => {
    showModal.value = true;
  },
  closeModal: () => {
    showModal.value = false;
  },
  /** Reads the DOM right after a write, to prove updates are synchronous. */
  syncCheck: () => {
    count.value = 4;
    const button = document.getElementById('increment');
    return { text: button?.textContent, className: button?.className };
  },
  disposeRoot: () => {
    dispose?.();
    dispose = null;
  },
  probe: () => ({ ...probe }),
};

Object.assign(globalThis, { probe, actions });
