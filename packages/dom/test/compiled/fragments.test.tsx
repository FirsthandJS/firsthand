/**
 * Fragments: a dynamic child of a fragment has no parent element to bind to
 * when it is written, and getting that wrong is invisible until an example
 * stops working. These assert the three things it must still do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  component,
  createContext,
  onCleanup,
  provide,
  render,
  signal,
  useContext,
} from '@firsthandjs/dom';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('fragment children', () => {
  it('updates a dynamic child in place', () => {
    const count = signal(0);
    const App = component(() => (
      <>
        <h1>title</h1>
        {count.value}
        <b>tail</b>
      </>
    ));
    const dispose = render(() => <App />, host);
    expect(host.textContent).toBe('title0tail');
    const heading = host.querySelector('h1');
    const tail = host.querySelector('b');

    count.value = 7;

    expect(host.textContent).toBe('title7tail');
    // Order preserved and the static siblings untouched.
    expect(host.querySelector('h1')).toBe(heading);
    expect(host.querySelector('b')).toBe(tail);
    dispose();
  });

  it('resolves context from where the child was written, not where it landed', () => {
    const Context = createContext<string>();
    const Leaf = component(() => <span>{useContext(Context).value}</span>);
    const App = component(() => {
      provide(Context, 'from-app');
      return (
        <>
          <h1>title</h1>
          <Leaf />
        </>
      );
    });

    const dispose = render(() => <App />, host);
    expect(host.querySelector('span')?.textContent).toBe('from-app');
    dispose();
  });

  it('disposes a fragment child with the component that wrote it', () => {
    const cleaned = vi.fn();
    const source = signal(0);
    const runs = vi.fn();
    const App = component(() => {
      onCleanup(cleaned);
      return (
        <>
          <h1>title</h1>
          {(runs(), source.value)}
        </>
      );
    });

    const dispose = render(() => <App />, host);
    expect(runs).toHaveBeenCalledTimes(1);
    source.value = 1;
    expect(runs).toHaveBeenCalledTimes(2);

    dispose();
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe('');
    source.value = 2;
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('supports a conditional and a keyed list inside a fragment', () => {
    const show = signal(true);
    const rows = signal([{ id: 1 }, { id: 2 }]);
    const App = component(() => (
      <>
        {show.value ? <b id="yes">yes</b> : <i id="no">no</i>}
        <ul>
          {rows.value.map((row) => (
            <li key={row.id}>{row.id}</li>
          ))}
        </ul>
      </>
    ));

    const dispose = render(() => <App />, host);
    expect(host.querySelector('#yes')).not.toBeNull();
    expect(host.querySelectorAll('li')).toHaveLength(2);

    const first = host.querySelector('li');
    show.value = false;
    expect(host.querySelector('#no')).not.toBeNull();
    // The list is a sibling of the branch: switching one must not touch it.
    expect(host.querySelector('li')).toBe(first);

    rows.value = [{ id: 2 }, { id: 1 }];
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['2', '1']);
    dispose();
  });
});
