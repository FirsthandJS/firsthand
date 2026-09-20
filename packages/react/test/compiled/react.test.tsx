/**
 * The React bridge.
 *
 * These use a hand-written React component rather than MUI, because the bridge
 * cannot tell them apart and MUI would add fifty megabytes to this
 * repository's install. MUI itself is driven in a real browser by
 * `integrations/interop`, which is where a claim about MUI belongs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import { fromReact, ReactHost, setReactWrapper } from '@firsthandjs/react';
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

afterEach(cleanup);

interface CardProps {
  readonly title: string;
  readonly tone?: 'plain' | 'loud';
  readonly onPing?: () => void;
  readonly children?: ReactNode;
}

/** An ordinary React component, hooks and all. */
function Card({ title, tone = 'plain', onPing, children }: CardProps): ReactNode {
  const [count, setCount] = useState(0);
  return createElement(
    'article',
    { className: `card ${tone}`, 'data-testid': 'card' },
    createElement('h3', null, title),
    createElement(
      'button',
      {
        'data-testid': 'react-button',
        onClick: () => {
          setCount((previous) => previous + 1);
          onPing?.();
        },
      },
      `clicked ${String(count)}`,
    ),
    children,
  );
}

const BridgedCard = fromReact(Card);

/**
 * Waits until React has produced what the assertion needs.
 *
 * React schedules its own work, so "how many microtasks until it is done"
 * depends on the machine: a fixed `await tick()` passes locally and fails on a
 * slower CI runner, which is exactly what happened. Waiting for the condition
 * instead makes the test say what it is waiting for.
 */
async function until(ready: () => boolean, turns = 60): Promise<void> {
  for (let turn = 0; turn < turns && !ready(); turn++) {
    await tick();
  }
}

/** The common case: a selector that React has to render first. */
const shows = (view: { container: HTMLElement }, selector: string) =>
  until(() => view.container.querySelector(selector) !== null);

describe('fromReact', () => {
  it('renders a React component into the Firsthand tree', async () => {
    const view = mount(() => <BridgedCard title="Hello" />);
    await shows(view, '[data-testid="card"] h3');

    expect(view.get('[data-testid="card"] h3').textContent).toBe('Hello');
    expect(view.get('[data-testid="card"]').className).toBe('card plain');
  });

  it('passes props, and re-renders React when one changes', async () => {
    const tone = signal<'plain' | 'loud'>('plain');
    const view = mount(() => <BridgedCard title="Hello" tone={tone.value} />);
    await shows(view, '[data-testid="card"]');

    tone.value = 'loud';
    await until(() => view.get('[data-testid="card"]').className === 'card loud');

    expect(view.get('[data-testid="card"]').className).toBe('card loud');
  });

  it('keeps React state across a prop change', async () => {
    const title = signal('First');
    const view = mount(() => <BridgedCard title={title.value} />);
    await shows(view, '[data-testid="react-button"]');

    view.get<HTMLButtonElement>('[data-testid="react-button"]').click();
    await until(() => view.get('[data-testid="react-button"]').textContent === 'clicked 1');
    expect(view.get('[data-testid="react-button"]').textContent).toBe('clicked 1');

    title.value = 'Second';
    await until(() => view.get('h3').textContent === 'Second');

    // The React root was updated, not replaced: its useState survived.
    expect(view.get('h3').textContent).toBe('Second');
    expect(view.get('[data-testid="react-button"]').textContent).toBe('clicked 1');
  });

  it('calls back into Firsthand from a React event', async () => {
    const pings = vi.fn();
    const view = mount(() => <BridgedCard title="Hello" onPing={pings} />);
    await shows(view, '[data-testid="react-button"]');

    view.get<HTMLButtonElement>('[data-testid="react-button"]').click();
    await until(() => pings.mock.calls.length > 0);

    expect(pings).toHaveBeenCalledTimes(1);
  });

  it('adopts Firsthand children into the React tree', async () => {
    const label = signal('inside');
    const view = mount(() => (
      <BridgedCard title="Hello">
        <em data-testid="own">{label.value}</em>
      </BridgedCard>
    ));
    await shows(view, '[data-testid="own"]');

    const own = view.get('[data-testid="own"]');
    expect(own.textContent).toBe('inside');
    // It is inside the React-rendered article, not beside it.
    expect(view.get('[data-testid="card"]').contains(own)).toBe(true);

    // And it is still a Firsthand node: updating it does not go through React.
    label.value = 'updated';
    expect(view.get('[data-testid="own"]').textContent).toBe('updated');
    expect(view.get('[data-testid="own"]')).toBe(own);
  });

  it('adopts text and arrays of children too', async () => {
    const view = mount(() => (
      <BridgedCard title="Hello">
        {'plain text'}
        {[<i key="a">a</i>, <i key="b">b</i>]}
        {null}
        {false}
      </BridgedCard>
    ));
    await shows(view, '[data-testid="card"] i');

    expect(view.get('[data-testid="card"]').textContent).toContain('plain text');
    expect(view.all('[data-testid="card"] i')).toHaveLength(2);
  });

  it('takes a host element and a class', async () => {
    const view = mount(() => <BridgedCard title="Hello" host="div" class="wrapper" />);
    await shows(view, '[data-testid="card"]');

    const host = view.get('div.wrapper');
    expect(host.tagName).toBe('DIV');
    // Neither reached the React component as a prop.
    expect(view.get('[data-testid="card"]').className).toBe('card plain');
  });

  it('defaults to a span, so inline layout survives', async () => {
    const view = mount(() => <BridgedCard title="Hello" />);
    await shows(view, '[data-testid="card"]');
    expect(view.container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('unmounts the React root when the Firsthand component goes away', async () => {
    const view = mount(() => <BridgedCard title="Hello" />);
    await shows(view, '[data-testid="card"]');
    expect(view.container.querySelector('[data-testid="card"]')).not.toBeNull();

    view.unmount();
    // Unmounting is deferred to a microtask, so this waits for the absence.
    await until(() => document.querySelector('[data-testid="card"]') === null);

    expect(document.querySelector('[data-testid="card"]')).toBeNull();
  });
});

describe('ReactHost', () => {
  it('renders a component chosen at runtime', async () => {
    const view = mount(() => (
      <ReactHost component={Card as never} props={{ title: 'Dynamic' }} host="div" />
    ));
    await shows(view, 'h3');

    expect(view.get('h3').textContent).toBe('Dynamic');
    expect(view.get('div').tagName).toBe('DIV');
  });

  it('works with no props at all', async () => {
    const Bare = (): ReactNode => createElement('b', { 'data-testid': 'bare' }, 'bare');
    const view = mount(() => <ReactHost component={Bare as never} />);
    await shows(view, '[data-testid="bare"]');

    expect(view.get('[data-testid="bare"]').textContent).toBe('bare');
  });
});

describe('naming', () => {
  it('takes the React component name, for devtools and element names', () => {
    expect(BridgedCard.name).toBe('React(Card)');

    // React's own preference order: displayName first.
    const Named = (): ReactNode => createElement('i');
    Named.displayName = 'Renamed';
    expect(fromReact(Named).name).toBe('React(Renamed)');

    // And a function with no name of its own is not called `React()`.
    expect(fromReact((): ReactNode => createElement('i')).name).toBe('React(Anonymous)');
  });
});

describe('@firsthandjs/react/auto', () => {
  it('renders a React component written directly as a TSX element', async () => {
    // The import is what installs the adapter; it is a side effect on purpose,
    // so that the opt-in is visible in the application's import list.
    await import('@firsthandjs/react/auto');

    const pings = signal(0);
    const view = mount(() => (
      <Card title="Direct" onPing={() => pings.value++}>
        inside
      </Card>
    ));
    await shows(view, 'h3');

    expect(view.get('h3').textContent).toBe('Direct');
    view.get<HTMLButtonElement>('[data-testid="react-button"]').click();
    await until(() => pings.value === 1);
    expect(pings.value).toBe(1);
  });

  it('adapts each component once, however often it is written', async () => {
    await import('@firsthandjs/react/auto');

    const view = mount(() => (
      <>
        <Card title="one" />
        <Card title="two" />
      </>
    ));
    // Two roots, each scheduling its own first render.
    await until(() => view.all('h3').length === 2);

    // Two instances, two React roots — but one bridge: an adapter called twice
    // for the same component would be two component *types*, and a keyed list
    // would then rebuild its rows whenever it re-read them.
    expect(view.all('h3').map((heading) => heading.textContent)).toEqual(['one', 'two']);
  });
});

describe('setReactWrapper', () => {
  afterEach(() => {
    setReactWrapper(null);
  });

  it('puts React context around every bridged root', async () => {
    // Two bridges are two React roots, so a provider rendered in one cannot
    // reach the other. This is how a provider reaches both.
    const ToneContext = createContext('plain');
    const Toned = fromReact(function Toned(): ReactNode {
      return createElement('span', { 'data-testid': 'tone' }, useContext(ToneContext));
    });

    const tone = signal('loud');
    setReactWrapper((node) => createElement(ToneContext.Provider, { value: tone.value }, node));

    const view = mount(() => (
      <>
        <Toned />
        <Toned />
      </>
    ));
    await until(() => view.all('[data-testid="tone"]').length === 2);

    expect(view.all('[data-testid="tone"]').map((node) => node.textContent)).toEqual([
      'loud',
      'loud',
    ]);

    // Reading a signal in the wrapper is an ordinary reactive read: changing
    // it re-renders every bridged root.
    tone.value = 'soft';
    await until(() =>
      view.all('[data-testid="tone"]').every((node) => node.textContent === 'soft'),
    );

    expect(view.all('[data-testid="tone"]').map((node) => node.textContent)).toEqual([
      'soft',
      'soft',
    ]);
  });

  it('renders the component alone once it is removed', async () => {
    const Bare = fromReact(function Bare(): ReactNode {
      return createElement('span', { 'data-testid': 'bare' }, 'bare');
    });
    setReactWrapper((node) => createElement('div', { 'data-testid': 'wrapper' }, node));

    const view = mount(() => <Bare />);
    await shows(view, '[data-testid="wrapper"]');
    expect(view.get('[data-testid="wrapper"]')).not.toBeNull();

    setReactWrapper(null);
    await until(() => view.container.querySelector('[data-testid="wrapper"]') === null);
    expect(view.container.querySelector('[data-testid="wrapper"]')).toBeNull();
    expect(view.get('[data-testid="bare"]').textContent).toBe('bare');
  });
});
