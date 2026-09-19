/**
 * The bridge, where two features meet.
 *
 * Direct elements, the wrapper, keyed lists and disposal each work; these are
 * the combinations that could break each other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import { fromReact, setReactWrapper } from '@firsthandjs/react';
import { createContext, createElement, useContext, type ReactNode } from 'react';
import '@firsthandjs/react/auto';

afterEach(async () => {
  cleanup();
  setReactWrapper(null);
  // React unmounts in a microtask, so the next test starts on a clean document.
  await tick();
});

function Label(props: { readonly text: string }): ReactNode {
  return createElement('b', { 'data-testid': 'label' }, props.text);
}

/**
 * Waits for React to have rendered `count` roots.
 *
 * React schedules its own work, and a root per bridged instance means several
 * independent schedules; a fixed number of ticks would be a guess that gets
 * flakier the more instances a test mounts.
 */
async function settled(read: () => number, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && read() < count; attempt++) {
    await tick();
  }
}

describe('direct React elements', () => {
  it('work as rows of a keyed list, and survive a reorder', async () => {
    const items = signal([1, 2, 3]);
    const view = mount(() => (
      <ul>
        {items.value.map((id) => (
          <li key={id} data-row={id}>
            <Label text={`item ${String(id)}`} />
          </li>
        ))}
      </ul>
    ));
    await settled(() => view.all('[data-testid="label"]').length, 3);

    expect(view.all('[data-testid="label"]').map((n) => n.textContent)).toEqual([
      'item 1',
      'item 2',
      'item 3',
    ]);

    const second = view.all('li')[1];
    items.value = [3, 2, 1];
    await settled(() => view.all('[data-testid="label"]').length, 3);

    expect(view.all('li')[1]).toBe(second);
    expect(view.all('[data-testid="label"]').map((n) => n.textContent)).toEqual([
      'item 3',
      'item 2',
      'item 1',
    ]);
  });

  it('are removed with the branch that held them', async () => {
    const shown = signal(true);
    const view = mount(() => <div>{shown.value ? <Label text="here" /> : null}</div>);
    await tick();
    expect(view.get('[data-testid="label"]').textContent).toBe('here');

    shown.value = false;
    await tick();
    await tick();
    expect(view.container.querySelector('[data-testid="label"]')).toBeNull();
  });

  it('take a wrapper installed after they were first rendered', async () => {
    const ToneContext = createContext('plain');
    function Toned(): ReactNode {
      return createElement('span', { 'data-testid': 'tone' }, useContext(ToneContext));
    }

    const view = mount(() => <Toned />);
    await tick();
    await tick();
    expect(view.get('[data-testid="tone"]').textContent).toBe('plain');

    setReactWrapper((node) => createElement(ToneContext.Provider, { value: 'loud' }, node));
    await tick();
    await tick();
    expect(view.get('[data-testid="tone"]').textContent).toBe('loud');
  });
});

describe('a bridge and a direct element side by side', () => {
  it('are the same component, adapted once', async () => {
    const Declared = fromReact(Label);
    const view = mount(() => (
      <>
        <Declared text="declared" />
        <Label text="direct" />
      </>
    ));
    await settled(() => view.all('[data-testid="label"]').length, 2);

    // Two roots either way — the point is that both render, and that writing
    // it one way does not disturb the other.
    expect(view.all('[data-testid="label"]').map((n) => n.textContent)).toEqual([
      'declared',
      'direct',
    ]);
  });

  it('both see the wrapper', async () => {
    const ToneContext = createContext('plain');
    function Toned(): ReactNode {
      return createElement('span', { 'data-testid': 'tone' }, useContext(ToneContext));
    }
    const Declared = fromReact(Toned);
    setReactWrapper((node) => createElement(ToneContext.Provider, { value: 'shared' }, node));

    const view = mount(() => (
      <>
        <Declared />
        <Toned />
      </>
    ));
    await settled(() => view.all('[data-testid="tone"]').length, 2);

    expect(view.all('[data-testid="tone"]').map((n) => n.textContent)).toEqual([
      'shared',
      'shared',
    ]);
  });
});
