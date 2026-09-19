/**
 * The acceptance criteria, exercised end to end through TSX.
 *
 * These tests use the runtime JSX path, where a thunk is how a dynamic
 * expression is expressed (see `@firsthandjs/jsx-runtime`). The compiler produces
 * the same thunks from ordinary expressions; the semantics under test are
 * identical either way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  component,
  computed,
  createComponent,
  createContext,
  portal,
  provide,
  render,
  signal,
  useContext,
  list,
  type ReadonlyCell,
  type ReadonlyProps,
} from '../src/index.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('components', () => {
  it('runs the setup function exactly once per instance', () => {
    const setup = vi.fn();
    const Counter = component(() => {
      setup();
      const count = signal(0);
      return (
        <button onClick={() => count.value++}>{() => `Count: ${count.value}`}</button>
      ) as HTMLElement;
    });

    const dispose = render(() => <Counter />, host);
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Count: 0');

    button.click();
    button.click();

    expect(button.textContent).toBe('Count: 2');
    expect(setup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('updates only the DOM parts that read the changed state', () => {
    const count = signal(0);
    const unrelated = signal('static');
    const Widget = component(() => (
      <div>
        <span id="dynamic">{() => count.value}</span>
        <span id="other">{() => unrelated.value}</span>
      </div>
    ));
    const dispose = render(() => <Widget />, host);
    const dynamic = host.querySelector('#dynamic') as HTMLElement;
    const other = host.querySelector('#other') as HTMLElement;
    const otherTextNode = other.firstChild;

    count.value = 5;

    expect(dynamic.textContent).toBe('5');
    // The untouched part kept its very node: nothing was re-created.
    expect(other.firstChild).toBe(otherTextNode);
    dispose();
  });

  it('keeps event handlers stable and always reading current state', () => {
    const seen: number[] = [];
    const Counter = component(() => {
      const count = signal(0);
      const handler = (): void => {
        seen.push(count.value);
        count.value++;
      };
      return (<button onClick={handler}>{() => count.value}</button>) as HTMLElement;
    });
    const dispose = render(() => <Counter />, host);
    const button = host.querySelector('button') as HTMLButtonElement;
    const firstHandler = (button as unknown as Record<string, unknown>)['$firsthand$click'];
    button.click();
    button.click();
    button.click();
    expect(seen).toEqual([0, 1, 2]);
    expect((button as unknown as Record<string, unknown>)['$firsthand$click']).toBe(firstHandler);
    dispose();
  });

  it('does not re-run setup when a reactive prop changes', () => {
    const setup = vi.fn();
    const user = signal({ name: 'Ada' });

    type CardProps = { user: { name: string } };
    const Card = component((props: ReadonlyProps<CardProps>) => {
      setup();
      return (<span>{() => props.user.name}</span>) as HTMLElement;
    });

    // This is exactly what the compiler emits for `<Card user={user.value} />`:
    // a props object whose dynamic key is an accessor (ADR-0005). JSX spread
    // would copy the value instead, which is the snapshot this design exists to
    // avoid — and why props destructuring is a compile error.
    const dispose = render(
      () =>
        createComponent(Card, {
          get user() {
            return user.value;
          },
        }),
      host,
    );

    expect(host.textContent).toBe('Ada');
    user.value = { name: 'Grace' };
    expect(host.textContent).toBe('Grace');
    expect(setup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('passes object props by reference, without copying or serialising', () => {
    const payload = { nested: { deep: true } };
    let received: unknown;
    const Sink = component((props: { data: typeof payload }) => {
      received = props.data;
      return null;
    });
    const dispose = render(() => <Sink data={payload} />, host);
    expect(received).toBe(payload);
    expect((received as typeof payload).nested).toBe(payload.nested);
    dispose();
  });

  it('rejects writing to a prop', () => {
    let props!: { value: number };
    const Sink = component((received: { value: number }) => {
      props = received;
      return null;
    });
    const dispose = render(() => <Sink value={1} />, host);
    expect(() => {
      props.value = 2;
    }).toThrow(TypeError);
    dispose();
  });

  it('computes derived values without re-running the component', () => {
    const setup = vi.fn();
    const Counter = component((props: ReadonlyProps<{ initial: number }>) => {
      setup();
      const count = signal(props.initial);
      const doubled = computed(() => count.value * 2);
      return (
        <button onClick={() => count.value++}>
          {() => `${count.value} x 2 = ${doubled.value}`}
        </button>
      ) as HTMLElement;
    });
    const dispose = render(() => <Counter initial={10} />, host);
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('10 x 2 = 20');
    button.click();
    expect(button.textContent).toBe('11 x 2 = 22');
    expect(setup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('disposes a component subtree when the root is disposed', () => {
    const cleaned = vi.fn();
    const source = signal(0);
    const runs = vi.fn();
    const Leaf = component(() => {
      const value = computed(() => {
        runs();
        return source.value;
      });
      return (<span>{() => value.value}</span>) as HTMLElement;
    });
    const dispose = render(() => <Leaf />, host);
    expect(runs).toHaveBeenCalledTimes(1);
    dispose();
    expect(host.innerHTML).toBe('');
    source.value = 1;
    expect(runs).toHaveBeenCalledTimes(1);
    expect(cleaned).not.toHaveBeenCalled();
  });
});

describe('conditional rendering', () => {
  it('switches branches and disposes the one it leaves', () => {
    const show = signal(true);
    const inner = signal('a');
    const panelRuns = vi.fn();

    const Panel = component(() => {
      panelRuns();
      return (<p id="panel">{() => inner.value}</p>) as HTMLElement;
    });
    const Placeholder = component(() => (<p id="placeholder">nothing</p>) as HTMLElement);

    const dispose = render(
      () => <div>{() => (show.value ? <Panel /> : <Placeholder />)}</div>,
      host,
    );

    expect(host.querySelector('#panel')?.textContent).toBe('a');
    inner.value = 'b';
    expect(host.querySelector('#panel')?.textContent).toBe('b');
    expect(panelRuns).toHaveBeenCalledTimes(1);

    show.value = false;
    expect(host.querySelector('#panel')).toBeNull();
    expect(host.querySelector('#placeholder')).not.toBeNull();

    // The inactive branch holds no subscriptions any more.
    inner.value = 'c';
    show.value = true;
    expect(host.querySelector('#panel')?.textContent).toBe('c');
    expect(panelRuns).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('renders nothing for a falsy branch', () => {
    const show = signal(false);
    const dispose = render(
      () => <div id="wrap">{() => (show.value ? <b>yes</b> : null)}</div>,
      host,
    );
    expect(host.querySelector('#wrap')?.textContent).toBe('');
    show.value = true;
    expect(host.querySelector('#wrap')?.textContent).toBe('yes');
    show.value = false;
    expect(host.querySelector('#wrap')?.textContent).toBe('');
    dispose();
  });
});

describe('context', () => {
  type Theme = { mode: 'light' | 'dark' };

  it('reaches a deeply nested consumer and updates it in place', () => {
    const ThemeContext = createContext<Theme>();
    const theme = signal<Theme>({ mode: 'light' });
    const buttonSetup = vi.fn();

    const Button = component(() => {
      buttonSetup();
      const current: ReadonlyCell<Theme> = useContext(ThemeContext);
      return (<button>{() => current.value.mode}</button>) as HTMLElement;
    });
    const Middle = component(
      () =>
        (
          <div>
            <Button />
          </div>
        ) as HTMLElement,
    );
    const App = component(() => {
      provide(ThemeContext, theme);
      return (
        <section>
          <Middle />
        </section>
      ) as HTMLElement;
    });

    const dispose = render(() => <App />, host);
    expect(host.querySelector('button')?.textContent).toBe('light');
    theme.value = { mode: 'dark' };
    expect(host.querySelector('button')?.textContent).toBe('dark');
    expect(buttonSetup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('survives a portal: the physical parent is not the logical parent', () => {
    const Context = createContext<string>();
    const Modal = component(() => {
      const value = useContext(Context);
      return (<div id="modal">{() => value.value}</div>) as HTMLElement;
    });
    const App = component(() => {
      provide(Context, 'from-app');
      return (<div>{portal(<Modal />, document.body)}</div>) as HTMLElement;
    });

    const dispose = render(() => <App />, host);
    const modal = document.querySelector('#modal') as HTMLElement;
    expect(modal.parentNode).toBe(document.body);
    expect(modal.textContent).toBe('from-app');
    dispose();
    expect(document.querySelector('#modal')).toBeNull();
  });
});

describe('keyed lists', () => {
  type Row = { id: number; label: string };

  const rows = (...ids: number[]): Row[] => ids.map((id) => ({ id, label: `row-${id}` }));

  function mountList(items: { value: Row[] }): () => void {
    const RowView = component((props: { row: ReadonlyCell<Row> }) => {
      return (
        <li data-id={() => String(props.row.value.id)}>{() => props.row.value.label}</li>
      ) as HTMLElement;
    });
    return render(
      () => (
        <ul id="list">
          {list(
            () => items.value,
            (row: Row) => row.id,
            (row: ReadonlyCell<Row>) => (
              <RowView row={row} />
            ),
          )}
        </ul>
      ),
      host,
    );
  }

  const ids = (): number[] =>
    [...host.querySelectorAll('li')].map((li) => Number(li.getAttribute('data-id')));

  it('appends, prepends, removes, swaps and reverses while reusing nodes', () => {
    const items = signal(rows(1, 2, 3));
    const dispose = mountList(items);
    const initial = [...host.querySelectorAll('li')];
    expect(ids()).toEqual([1, 2, 3]);

    items.value = rows(1, 2, 3, 4);
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(host.querySelectorAll('li')[0]).toBe(initial[0]);

    items.value = rows(0, 1, 2, 3, 4);
    expect(ids()).toEqual([0, 1, 2, 3, 4]);

    items.value = rows(0, 1, 3, 4);
    expect(ids()).toEqual([0, 1, 3, 4]);

    items.value = rows(4, 1, 3, 0);
    expect(ids()).toEqual([4, 1, 3, 0]);

    items.value = rows(0, 3, 1, 4);
    expect(ids()).toEqual([0, 3, 1, 4]);

    // Every surviving row kept its original element.
    const byId = new Map(initial.map((li) => [li.getAttribute('data-id'), li]));
    for (const li of host.querySelectorAll('li')) {
      const original = byId.get(li.getAttribute('data-id'));
      if (original !== undefined) {
        expect(li).toBe(original);
      }
    }
    dispose();
  });

  it('updates a single row without touching its neighbours', () => {
    const items = signal(rows(1, 2, 3));
    const dispose = mountList(items);
    const elements = [...host.querySelectorAll('li')];

    items.value = [items.value[0] as Row, { id: 2, label: 'changed' }, items.value[2] as Row];

    expect(elements[1]?.textContent).toBe('changed');
    expect([...host.querySelectorAll('li')]).toEqual(elements);
    dispose();
  });

  it('clears and refills', () => {
    const items = signal(rows(1, 2, 3));
    const dispose = mountList(items);
    items.value = [];
    expect(host.querySelectorAll('li')).toHaveLength(0);
    items.value = rows(7, 8);
    expect(ids()).toEqual([7, 8]);
    dispose();
  });

  it('warns and drops duplicates rather than corrupting the DOM', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = signal([
      { id: 1, label: 'a' },
      { id: 1, label: 'b' },
    ]);
    const dispose = mountList(items);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate list key'));
    expect(host.querySelectorAll('li')).toHaveLength(1);
    warn.mockRestore();
    dispose();
  });

  it('handles ten thousand rows', () => {
    const items = signal(rows(...Array.from({ length: 10_000 }, (_, i) => i)));
    const dispose = mountList(items);
    expect(host.querySelectorAll('li')).toHaveLength(10_000);
    items.value = items.value.slice().reverse();
    expect(ids()[0]).toBe(9999);
    items.value = [];
    expect(host.querySelectorAll('li')).toHaveLength(0);
    dispose();
  });
});
