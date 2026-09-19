/**
 * The page-side harness.
 *
 * Exposes one API to the runner so that both implementations are driven by
 * exactly the same calls, in the same page, in the same browser process.
 */
import { createFirsthandImplementation } from './firsthand.tsx';
import { createReactImplementation } from './react.jsx';

const factories = {
  firsthand: createFirsthandImplementation,
  react: createReactImplementation,
};

let current = null;

globalThis.harness = {
  /**
   * Mounts one implementation into a fresh container.
   *
   * `mode` selects which application the scenario needs: the row table, a deep
   * component tree, a provider with many consumers, or a single counter. Both
   * implementations expose the same four.
   */
  mount(name, seed, mode = 'table', argument = 0) {
    this.unmount();
    const container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
    current = { impl: factories[name](container, seed, mode, argument), container };
  },

  unmount() {
    if (current !== null) {
      current.impl.dispose();
      current.container.remove();
      current = null;
    }
  },

  /** Runs an operation and returns the time until the DOM has been laid out. */
  measure(operation, argument) {
    const start = performance.now();
    current.impl.run(operation, argument);
    // Forces style and layout, so the measurement covers the DOM work rather
    // than stopping at the last JavaScript statement.
    void document.body.offsetHeight;
    return performance.now() - start;
  },

  run(operation, argument) {
    current.impl.run(operation, argument);
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
