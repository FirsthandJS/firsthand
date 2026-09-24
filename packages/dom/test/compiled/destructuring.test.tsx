/**
 * Destructured props, rewritten into live reads.
 *
 * `component(({ todo }) => ...)` is the shape people write. Without the
 * rewrite it silently captures the value once, at setup. These assert that it
 * means what it looks like: every read is live, and the component still runs
 * only once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { component, render, signal } from '@firsthandjs/dom';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

type Todo = { title: string; done: boolean };

describe('destructured props', () => {
  it('reads a destructured prop live, without re-running setup', () => {
    const setup = vi.fn();
    const todo = signal<Todo>({ title: 'first', done: false });

    const Row = component<{ todo: Todo }>(({ todo: item }) => {
      setup();
      return <li>{item.title}</li>;
    });
    const App = component(() => (
      <ul>
        <Row todo={todo.value} />
      </ul>
    ));

    const dispose = render(() => <App />, host);
    expect(host.textContent).toBe('first');

    todo.value = { title: 'second', done: false };

    expect(host.textContent).toBe('second');
    expect(setup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('applies a default on every read, not once at setup', () => {
    const count = signal<number | undefined>(undefined);
    const Badge = component<{ count?: number }>(({ count: value = 0 }) => <b>{value}</b>);
    const App = component(() => <Badge count={count.value} />);

    const dispose = render(() => <App />, host);
    expect(host.textContent).toBe('0');
    count.value = 7;
    expect(host.textContent).toBe('7');
    count.value = undefined;
    expect(host.textContent).toBe('0');
    dispose();
  });

  it('destructures nested patterns', () => {
    const user = signal({ name: { first: 'Ada' } });
    const Name = component<{ user: { name: { first: string } } }>(
      ({
        user: {
          name: { first },
        },
      }) => <span>{first}</span>,
    );
    const App = component(() => <Name user={user.value} />);

    const dispose = render(() => <App />, host);
    expect(host.textContent).toBe('Ada');
    user.value = { name: { first: 'Grace' } };
    expect(host.textContent).toBe('Grace');
    dispose();
  });

  it('forwards the rest of the props, still live', () => {
    const title = signal('first');
    const Row = component<{ label: string; title: string; id: string }>(({ label, ...rest }) => (
      <p {...rest}>{label}</p>
    ));
    const App = component(() => <Row label="text" title={title.value} id="row" />);

    const dispose = render(() => <App />, host);
    const paragraph = host.querySelector('p') as HTMLParagraphElement;
    expect(paragraph.textContent).toBe('text');
    expect(paragraph.title).toBe('first');
    expect(paragraph.id).toBe('row');

    title.value = 'second';
    expect(paragraph.title).toBe('second');
    // The same element: forwarding did not rebuild it.
    expect(host.querySelector('p')).toBe(paragraph);
    dispose();
  });

  it('keeps a handler prop stable and callable', () => {
    const clicks: number[] = [];
    const count = signal(0);
    const Button = component<{ onPress: () => void; count: number }>(
      ({ onPress, count: value }) => <button onClick={onPress}>{value}</button>,
    );
    const App = component(() => (
      <Button
        count={count.value}
        onPress={() => {
          clicks.push(count.value);
          count.value++;
        }}
      />
    ));

    const dispose = render(() => <App />, host);
    const button = host.querySelector('button') as HTMLButtonElement;
    button.click();
    button.click();
    expect(clicks).toEqual([0, 1]);
    expect(button.textContent).toBe('2');
    dispose();
  });

  /**
   * What a default means.
   *
   * The rewrite turns `{ count = 0 }` into a read plus a default, and the
   * shorthand for that is `??` - which also answers for `null`. The language
   * does not: a destructuring default applies to `undefined` alone, and a
   * parent that passes `null` means null. The difference is not academic,
   * because `null` is what an API returns for "known to be empty", and `0` is
   * what a badge would then show where the parent asked for nothing. Per-read
   * re-application is the test above this one; these are about which values
   * count as absent.
   */
  describe('a default', () => {
    it('does not apply to an explicit null, which is a value', () => {
      const count = signal<number | null>(null);
      const Badge = component<{ count?: number | null }>(({ count = 7 }) => <b>{String(count)}</b>);
      const App = component(() => <Badge count={count.value} />);

      const dispose = render(() => <App />, host);
      expect(host.textContent).toBe('null');
      dispose();
    });

    it('does not apply to an explicit zero or empty string either', () => {
      const Badge = component<{ count?: number }>(({ count = 7 }) => <b>{count}</b>);
      const Label = component<{ text?: string }>(({ text = 'none' }) => <i>{text}</i>);
      const App = component(() => (
        <>
          <Badge count={0} />
          <Label text="" />
        </>
      ));

      const dispose = render(() => <App />, host);
      expect(host.textContent).toBe('0');
      dispose();
    });
  });
});
