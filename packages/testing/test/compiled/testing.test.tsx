/**
 * The test helpers, tested — and by being used the way a consumer would use
 * them, which is also the proof that Firsthand works under Vitest.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, computed, onCleanup, signal } from '@firsthandjs/dom';
import { autoCleanup, cleanup, mount, subscriberCount, tick, withRoot } from '@firsthandjs/testing';

afterEach(cleanup);

describe('mount', () => {
  it('renders into a container attached to the document', () => {
    const view = mount(() => <p class="greeting">hello</p>);
    expect(view.text()).toBe('hello');
    expect(view.get('.greeting').isConnected).toBe(true);
    expect(view.container.parentNode).toBe(document.body);
  });

  it('updates without any awaiting, because writes are synchronous', () => {
    const count = signal(0);
    const Counter = component(() => <button onClick={() => count.value++}>{count.value}</button>);
    const view = mount(() => <Counter />);

    view.get<HTMLButtonElement>('button').click();

    expect(view.text()).toBe('1');
  });

  it('unmounts once, however often it is asked', () => {
    const cleaned = vi.fn();
    const Leaf = component(() => {
      onCleanup(cleaned);
      return <i>leaf</i>;
    });
    const view = mount(() => <Leaf />);
    view.unmount();
    view.unmount();
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(view.container.parentNode).toBeNull();
  });

  it('accepts a different parent', () => {
    const section = document.createElement('section');
    document.body.appendChild(section);
    const view = mount(() => <p>inside</p>, section);
    expect(view.container.parentNode).toBe(section);
    view.unmount();
    section.remove();
  });

  it('explains itself when a selector matches nothing', () => {
    const view = mount(() => <p>only this</p>);
    expect(() => view.get('.missing')).toThrow(/No element matched \.missing/);
    expect(() => view.get('.missing')).toThrow(/only this/);
  });

  it('returns all matches as an array', () => {
    const view = mount(() => (
      <ul>
        <li>a</li>
        <li>b</li>
      </ul>
    ));
    expect(view.all('li').map((item) => item.textContent)).toEqual(['a', 'b']);
  });
});

describe('cleanup', () => {
  it('unmounts everything still standing', () => {
    mount(() => <p id="one">one</p>);
    mount(() => <p id="two">two</p>);
    expect(document.querySelectorAll('p')).toHaveLength(2);
    cleanup();
    expect(document.querySelectorAll('p')).toHaveLength(0);
  });

  it('registers with the surrounding framework when there is one', () => {
    const hooks: (() => void)[] = [];
    const original = (globalThis as { afterEach?: unknown }).afterEach;
    (globalThis as { afterEach?: unknown }).afterEach = (fn: () => void) => hooks.push(fn);
    expect(autoCleanup()).toBe(true);
    expect(hooks).toHaveLength(1);

    (globalThis as { afterEach?: unknown }).afterEach = undefined;
    expect(autoCleanup()).toBe(false);
    (globalThis as { afterEach?: unknown }).afterEach = original;
  });
});

describe('reactivity without a DOM', () => {
  it('runs a root and hands back its disposer', () => {
    const source = signal(1);
    const { value, dispose } = withRoot(() => computed(() => source.value * 2));
    expect(value.value).toBe(2);
    source.value = 3;
    expect(value.value).toBe(6);

    expect(subscriberCount(source)).toBe(1);
    dispose();
    expect(subscriberCount(source)).toBe(0);
  });

  it('counts subscribers so a leak test can assert on them', () => {
    const shared = signal(0);
    expect(subscriberCount(shared)).toBe(0);
    const view = mount(() => <p>{shared.value}</p>);
    expect(subscriberCount(shared)).toBe(1);
    view.unmount();
    expect(subscriberCount(shared)).toBe(0);
  });
});

describe('tick', () => {
  it('waits for asynchronous application code', async () => {
    const loaded = signal('pending');
    const Async = component(() => {
      void Promise.resolve('done').then((value) => {
        loaded.value = value;
      });
      return <p>{loaded.value}</p>;
    });
    const view = mount(() => <Async />);
    expect(view.text()).toBe('pending');
    await tick();
    expect(view.text()).toBe('done');
  });
});
