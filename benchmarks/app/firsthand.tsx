/**
 * The Firsthand implementation of the benchmark application.
 *
 * The row table lives in `table.tsx` and is shared, unchanged, with the
 * js-framework-benchmark implementation. What is here is the rest: the three
 * other application shapes the scenario list needs — a deep component tree, a
 * provider with many consumers, and a single counter.
 *
 * Compiled by the published `@firsthandjs/compiler` and importing the published
 * entry points. Compare it to `react.jsx`: same DOM, same data, same
 * operations.
 */
import {
  batch,
  component,
  createContext,
  portal,
  provide,
  render,
  signal,
  useContext,
  type Dispose,
} from '@firsthandjs/dom';
import { Table, createTableOperations } from './table.js';

// ---------------------------------------------------------------------------
// Deep tree: one component per level, a leaf at the bottom
// ---------------------------------------------------------------------------

const deepLabel = signal('start');

const Branch = component((props: { depth: number }) =>
  props.depth === 0 ? (
    <span class="leaf">{deepLabel.value}</span>
  ) : (
    <div class="level">
      <Branch depth={props.depth - 1} />
    </div>
  ),
);

const Deep = component(() => (
  <div id="deep">
    {Array.from({ length: 20 }, (_, i) => i).map((i) => (
      <Branch key={i} depth={25} />
    ))}
  </div>
));

// ---------------------------------------------------------------------------
// Context: one provider, many consumers
// ---------------------------------------------------------------------------

const ThemeContext = createContext<string>();
const theme = signal('light');

const Consumer = component((props: { index: number }) => {
  const current = useContext(ThemeContext);
  // One interpolation rather than two: two adjacent dynamic children need an
  // anchor comment between them, and React emits a single text node here. Same
  // work on both sides, and the DOM-equality check stays meaningful.
  return <li class="consumer">{`${String(props.index)}:${current.value}`}</li>;
});

const Consumers = component((props: { count: number }) => {
  provide(ThemeContext, theme);
  return (
    <ul id="consumers">
      {Array.from({ length: props.count }, (_, i) => i).map((i) => (
        <Consumer key={i} index={i} />
      ))}
    </ul>
  );
});

// ---------------------------------------------------------------------------
// Portal: content rendered into a foreign container
// ---------------------------------------------------------------------------

const portalValue = signal(0);
let portalTarget: HTMLElement | null = null;

const PortalBody = component(() => (
  <div id="portal-body">
    <span class="portal-value">{portalValue.value}</span>
  </div>
));

const WithPortal = component(() => (
  <div id="portal-host">{portal(<PortalBody />, portalTarget as HTMLElement)}</div>
));

// ---------------------------------------------------------------------------
// Input: a controlled field, for event-to-DOM latency
// ---------------------------------------------------------------------------

const typed = signal('');

// The field is uncontrolled on both sides. Binding `value` would make React
// write a `value` attribute that Firsthand deliberately does not, and the two
// implementations would stop rendering the same DOM — which the equality phase
// would (correctly) reject. What is measured is the same either way: an event
// arrives, one text node changes.
const Input = component(() => (
  <div id="input-host">
    <input
      id="field"
      onInput={(event) => {
        typed.value = event.currentTarget.value;
      }}
    />
    <p id="echo">{typed.value}</p>
  </div>
));

// ---------------------------------------------------------------------------
// Counter: rapid updates
// ---------------------------------------------------------------------------

const counter = signal(0);
const Counter = component(() => <p id="counter">{counter.value}</p>);

// ---------------------------------------------------------------------------

export function createFirsthandImplementation(
  container: HTMLElement,
  seed: number,
  mode = 'table',
  argument = 0,
): { name: string; run(operation: string, argument: number): void; dispose: Dispose } {
  const table = createTableOperations(seed);
  deepLabel.value = 'start';
  theme.value = 'light';
  counter.value = 0;
  portalValue.value = 0;
  typed.value = '';
  portalTarget = document.getElementById('portal-target');

  const views: Record<string, () => unknown> = {
    table: () => <Table />,
    deep: () => <Deep />,
    counter: () => <Counter />,
    context: () => <Consumers count={argument} />,
    portal: () => <WithPortal />,
    input: () => <Input />,
  };
  const dispose = render(views[mode] as () => unknown, container);

  return {
    name: 'firsthand',
    run(operation: string, value: number): void {
      switch (operation) {
        case 'portalUpdate':
          portalValue.value++;
          return;
        case 'type': {
          // The same path a user takes: a real input event on the field.
          const field = document.getElementById('field') as HTMLInputElement | null;
          if (field !== null) {
            field.value = `typed ${String(value)}`;
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
          return;
        }
        case 'deepUpdate':
          deepLabel.value = deepLabel.value === 'start' ? 'changed' : 'start';
          return;
        case 'contextChange':
          theme.value = theme.value === 'light' ? 'dark' : 'light';
          return;
        case 'rapidUnbatched':
          // One synchronous DOM pass per write, by design (ADR-0006).
          for (let i = 0; i < value; i++) {
            counter.value++;
          }
          return;
        case 'rapidBatched':
          batch(() => {
            for (let i = 0; i < value; i++) {
              counter.value++;
            }
          });
          return;
        default:
          table(operation, value);
      }
    },
    dispose,
  };
}
