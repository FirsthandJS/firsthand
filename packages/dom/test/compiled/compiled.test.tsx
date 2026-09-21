/**
 * The compiled path, executed.
 *
 * These files go through the real `@firsthandjs/compiler` (see `vitest.config.ts`),
 * so what runs here is template cloning plus specialised DOM parts — the same
 * output the benchmark and the examples use. Plain JSX expressions, not thunks:
 * the compiler produces the thunks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  component,
  computed,
  createContext,
  portal,
  provide,
  render,
  signal,
  useContext,
  type ReadonlyProps,
} from '@firsthandjs/dom';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('compiled templates', () => {
  it('clones static markup and updates only the dynamic text', () => {
    const name = signal('Ada');
    const App = component(() => (
      <div class="row">
        Hello {name.value}
        <b>!</b>
      </div>
    ));

    const dispose = render(() => <App />, host);
    const row = host.querySelector('.row') as HTMLElement;
    const bold = row.querySelector('b') as HTMLElement;

    expect(row.textContent).toBe('Hello Ada!');
    name.value = 'Grace';
    expect(row.textContent).toBe('Hello Grace!');
    // The static part was never re-created.
    expect(row.querySelector('b')).toBe(bold);
    dispose();
  });

  it('runs setup once and keeps the handler stable', () => {
    const setup = vi.fn();
    const Counter = component((props: ReadonlyProps<{ initial: number }>) => {
      setup();
      const count = signal(props.initial);
      const doubled = computed(() => count.value * 2);
      return (
        <button
          class={count.value > 10 ? 'high' : 'normal'}
          disabled={count.value >= 100}
          onClick={() => count.value++}
        >
          {count.value} x 2 = {doubled.value}
        </button>
      );
    });

    const dispose = render(() => <Counter initial={10} />, host);
    const button = host.querySelector('button') as HTMLButtonElement;
    const handler = (button as unknown as Record<string, unknown>)['$firsthand$click'];

    expect(button.textContent).toBe('10 x 2 = 20');
    expect(button.className).toBe('normal');
    expect(button.disabled).toBe(false);

    button.click();

    expect(button.textContent).toBe('11 x 2 = 22');
    expect(button.className).toBe('high');
    expect(setup).toHaveBeenCalledTimes(1);
    expect((button as unknown as Record<string, unknown>)['$firsthand$click']).toBe(handler);
    dispose();
  });

  it('keeps a prop live without re-running setup', () => {
    const setup = vi.fn();
    const current = signal({ name: 'Ada' });

    const Card = component((props: ReadonlyProps<{ user: { name: string } }>) => {
      setup();
      return <span>{props.user.name}</span>;
    });
    const App = component(() => (
      <div>
        <Card user={current.value} />
      </div>
    ));

    const dispose = render(() => <App />, host);
    expect(host.textContent).toBe('Ada');
    current.value = { name: 'Grace' };
    expect(host.textContent).toBe('Grace');
    expect(setup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('switches a conditional branch without touching its siblings', () => {
    const show = signal(true);
    const App = component(() => (
      <div>
        <span id="before">before</span>
        {show.value ? <b id="yes">yes</b> : <i id="no">no</i>}
        <span id="after">after</span>
      </div>
    ));
    const dispose = render(() => <App />, host);
    const before = host.querySelector('#before');
    const after = host.querySelector('#after');

    expect(host.querySelector('#yes')).not.toBeNull();
    show.value = false;
    expect(host.querySelector('#yes')).toBeNull();
    expect(host.querySelector('#no')).not.toBeNull();
    // Order is preserved and the static siblings are the same nodes.
    expect(host.querySelector('#before')).toBe(before);
    expect(host.querySelector('#after')).toBe(after);
    expect((host.firstChild as HTMLElement).textContent).toBe('beforenoafter');
    dispose();
  });

  it('compiles a keyed map into a list that reuses rows', () => {
    type Row = { id: number; label: string };
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ]);
    const Table = component(() => (
      <ul>
        {rows.value.map((row, index) => (
          <li key={row.id} data-id={String(row.id)}>
            {index}:{row.label}
          </li>
        ))}
      </ul>
    ));

    const dispose = render(() => <Table />, host);
    const initial = [...host.querySelectorAll('li')];
    expect(initial.map((li) => li.textContent)).toEqual(['0:one', '1:two', '2:three']);

    // Reverse: same elements, new order, indices updated in place.
    rows.value = [...rows.value].reverse();
    const reversed = [...host.querySelectorAll('li')];
    expect(reversed.map((li) => li.getAttribute('data-id'))).toEqual(['3', '2', '1']);
    expect(reversed[0]).toBe(initial[2]);
    expect(reversed.map((li) => li.textContent)).toEqual(['0:three', '1:two', '2:one']);

    // Change one row's data: the row element survives, its text updates.
    rows.value = rows.value.map((row) => (row.id === 2 ? { id: 2, label: 'TWO' } : row));
    expect(host.querySelectorAll('li')[1]).toBe(initial[1]);
    expect(host.querySelectorAll('li')[1]?.textContent).toBe('1:TWO');

    rows.value = [];
    expect(host.querySelectorAll('li')).toHaveLength(0);
    dispose();
  });

  it('keeps a keyed list stable when it sits inside a conditional', () => {
    // Regression: the conditional used to evaluate the list inline, which made
    // it depend on the list's data — so every data change rebuilt every row.
    type Row = { id: number; label: string };
    const compact = signal(false);
    const rows = signal<Row[]>([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const setups = vi.fn();

    const Wide = component((props: { row: Row }) => {
      setups();
      return <li data-id={String(props.row.id)}>{props.row.label}</li>;
    });
    const Narrow = component((props: { row: Row }) => (
      <li data-id={String(props.row.id)}>{String(props.row.id)}</li>
    ));
    const App = component(() => (
      <ul>
        {compact.value
          ? rows.value.map((row) => <Narrow key={row.id} row={row} />)
          : rows.value.map((row) => <Wide key={row.id} row={row} />)}
      </ul>
    ));

    const dispose = render(() => <App />, host);
    const initial = [...host.querySelectorAll('li')];
    expect(setups).toHaveBeenCalledTimes(2);

    // Changing the data must update rows in place, not rebuild them.
    rows.value = rows.value.map((row) => ({ ...row, label: `${row.label}!` }));
    expect(setups).toHaveBeenCalledTimes(2);
    expect([...host.querySelectorAll('li')]).toEqual(initial);
    expect(initial[0]?.textContent).toBe('one!');

    // Switching the branch does rebuild, which is the correct behaviour.
    compact.value = true;
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelectorAll('li')[0]?.textContent).toBe('1');
    expect(host.querySelectorAll('li')[0]).not.toBe(initial[0]);

    // And the old branch is gone: no duplicated rows left behind.
    compact.value = false;
    expect(host.querySelectorAll('li')).toHaveLength(2);
    dispose();
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });

  it('carries context through a portal', () => {
    const Context = createContext<string>();
    const Modal = component(() => <div id="modal">{useContext(Context).value}</div>);
    const App = component(() => {
      provide(Context, 'from-app');
      return <div>{portal(<Modal />, document.body)}</div>;
    });

    const dispose = render(() => <App />, host);
    const modal = document.querySelector('#modal') as HTMLElement;
    expect(modal.parentNode).toBe(document.body);
    expect(modal.textContent).toBe('from-app');
    dispose();
    expect(document.querySelector('#modal')).toBeNull();
  });

  it('supports style objects, refs and boolean properties', () => {
    const visible = signal(true);
    let captured: HTMLElement | undefined;
    const App = component(() => (
      <input
        ref={(element: HTMLElement) => {
          captured = element;
        }}
        style={{ opacity: visible.value ? 1 : 0 }}
        disabled={!visible.value}
        value="typed"
      />
    ));
    const dispose = render(() => <App />, host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(captured).toBe(input);
    expect(input.style.opacity).toBe('1');
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('typed');
    visible.value = false;
    expect(input.style.opacity).toBe('0');
    expect(input.disabled).toBe(true);
    dispose();
  });
});

/**
 * An element the DOM library knows about, the way a component library's types
 * declare theirs. This is the case that matters: an element with no
 * declaration is typed permissively, so only a declared one can prove that
 * `slot` is allowed.
 */
class SlotHost extends HTMLElement {}
customElements.define('slot-host', SlotHost);

declare global {
  interface HTMLElementTagNameMap {
    'slot-host': SlotHost;
  }
}

describe('global attributes a custom element cares about', () => {
  it('puts `slot` on the element, which is how a web component is filled', () => {
    const host = document.createElement('div');
    document.body.append(host);

    // Web Awesome, Shoelace and every other component library places content
    // with `slot`. It is a property on `Element`, so it is excluded from an
    // element's own attributes and has to be declared as a global — without
    // that, this line is a type error rather than an icon in a button.
    render(
      () => (
        <slot-host>
          <span slot="start">icon</span>
        </slot-host>
      ),
      host,
    );

    expect(host.querySelector('span')?.getAttribute('slot')).toBe('start');
  });
});
