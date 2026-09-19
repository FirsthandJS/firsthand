/**
 * The smallest complete Firsthand application.
 *
 * `Counter` runs once. Clicking the button updates the text node, the class
 * attribute and the disabled property — and nothing else. Open the console:
 * "setup" is printed once per instance, no matter how often you click.
 */
import { component, computed, render, signal, type ReadonlyProps } from '@firsthandjs/dom';

const Counter = component((props: ReadonlyProps<{ initial: number }>) => {
  console.info('setup');

  const count = signal(props.initial);
  const doubled = computed(() => count.value * 2);
  const increment = (): void => {
    count.value++;
  };

  return (
    <p>
      <button
        class={count.value > 10 ? 'high' : 'normal'}
        disabled={count.value >= 20}
        onClick={increment}
      >
        {count.value} × 2 = {doubled.value}
      </button>
      {count.value > 10 && <strong> large value</strong>}
    </p>
  );
});

const App = component(() => (
  <>
    <h1>Counter</h1>
    <Counter initial={8} />
    <Counter initial={0} />
  </>
));

// No container argument and no element lookup: `render` mounts into
// `document.body` by default.
render(() => <App />);
