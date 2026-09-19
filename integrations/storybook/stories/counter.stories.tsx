/**
 * An ordinary component, told as a story.
 *
 * `args` are Storybook's, `props` are Firsthand's, and the only thing joining
 * them is `firsthand()`. Controls work because changing an arg re-runs the story,
 * which builds a new component instance — which is what Storybook does for
 * every framework.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { component, computed, signal } from '@firsthandjs/dom';
import { firsthand } from '../firsthand';

interface CounterArgs {
  initial: number;
  step: number;
}

const Counter = component<CounterArgs>(({ initial, step }) => {
  const count = signal(initial);
  const doubled = computed(() => count.value * 2);

  return (
    <p>
      <button
        data-testid="increment"
        class={count.value > 10 ? 'high' : 'normal'}
        onClick={() => (count.value += step)}
      >
        {count.value} × 2 = {doubled.value}
      </button>
    </p>
  );
});

const meta: Meta<CounterArgs> = {
  title: 'Components/Counter',
  argTypes: {
    initial: { control: { type: 'number' } },
    step: { control: { type: 'number' } },
  },
  args: { initial: 0, step: 1 },
  render: (args) => firsthand(() => <Counter initial={args.initial} step={args.step} />),
};

export default meta;

export const Default: StoryObj<CounterArgs> = {};

export const StartsHigh: StoryObj<CounterArgs> = {
  args: { initial: 11, step: 5 },
};
