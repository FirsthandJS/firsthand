/**
 * The page-side harness.
 *
 * Exposes one API to the runner so that both implementations are driven by
 * exactly the same calls, in the same page, in the same browser process.
 */
import { createFirsthandImplementation } from './firsthand.tsx';
import { createReactImplementation } from './react.jsx';
import { createSolidImplementation } from './solid.jsx';
import { createVueImplementation } from './vue.js';

const factories = {
  firsthand: createFirsthandImplementation,
  react: createReactImplementation,
  solid: createSolidImplementation,
  vue: createVueImplementation,
};

let current = null;

/**
 * Whether a measurement ends by forcing style and layout.
 *
 * On by default, because stopping the clock at the last JavaScript statement
 * would credit a framework for work the browser has not done yet. Turning it
 * off measures the framework's own work alone — which is the only way to see
 * how much of a scenario is even a framework's to win.
 */
let forceLayout = true;

globalThis.harness = {
  setLayout(on) {
    forceLayout = on;
  },

  /**
   * Mounts one implementation into a fresh container.
   *
   * `mode` selects which application the scenario needs: the row table, a deep
   * component tree, a provider with many consumers, or a single counter. Both
   * implementations expose the same four.
   */
  async mount(name, seed, mode = 'table', argument = 0) {
    this.unmount();
    const container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
    current = { impl: factories[name](container, seed, mode, argument), container };
    // A framework that mounts through its own scheduler has not finished when
    // `mount` returns; one hop is enough for all of them.
    await Promise.resolve();
  },

  unmount() {
    if (current !== null) {
      current.impl.dispose();
      current.container.remove();
      current = null;
    }
  },

  /**
   * Runs an operation and returns the time until the DOM has been laid out.
   *
   * Awaited, because one of the frameworks flushes on a microtask and cannot
   * be drained synchronously. Every framework pays the same hop: an `await` of
   * a value that is not a promise still yields once, so the constant is shared
   * rather than charged to the one that needs it.
   */
  async measure(operation, argument) {
    const start = performance.now();
    await current.impl.run(operation, argument);
    if (forceLayout) {
      void document.body.offsetHeight;
    }
    const elapsed = performance.now() - start;
    if (!forceLayout) {
      // The layout still has to happen before the next measurement, or it
      // would land inside it.
      void document.body.offsetHeight;
    }
    return elapsed;
  },

  async run(operation, argument) {
    await current.impl.run(operation, argument);
    void document.body.offsetHeight;
  },

  /** The rendered markup, used for the DOM-equality assertion. */
  snapshot() {
    return current.container.innerHTML;
  },

  rowCount() {
    return current.container.querySelectorAll('tbody > tr').length;
  },
};
