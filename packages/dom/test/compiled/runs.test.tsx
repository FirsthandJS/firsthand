/**
 * A render function keeps the DOM it made.
 *
 * The run happens again as a whole, and what it describes is written into the
 * nodes it described last time. A branch it leaves is disposed; a branch it
 * keeps is written into. Reads that belong to the run are written by the run;
 * reads that do not are parts, and update themselves without waking it.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, onCleanup, signal } from '@firsthandjs/dom';

afterEach(() => {
  cleanup();
});

describe('a site is kept between runs', () => {
  it('writes into the same nodes when the branch does not change', () => {
    const count = signal(0);
    let runs = 0;
    const App = component(() => () => {
      runs++;
      const doubled = count.value * 2;
      if (doubled > 10) {
        return <strong>{String(doubled)}</strong>;
      }
      return <span data-out>{String(doubled)}</span>;
    });
    const host = mount(() => <App />);
    const first = host.get('[data-out]');

    count.value = 1;
    expect(runs).toBe(2);
    expect(host.text()).toBe('2');
    expect(host.get('[data-out]')).toBe(first);

    count.value = 2;
    expect(host.text()).toBe('4');
    expect(host.get('[data-out]')).toBe(first);
  });

  it('keeps what the DOM was holding, which is the point', () => {
    const count = signal(0);
    const App = component(() => () => {
      const doubled = count.value * 2;
      return (
        <form>
          <input data-field />
          <output>{String(doubled)}</output>
        </form>
      );
    });
    const host = mount(() => <App />);
    const field = host.get<HTMLInputElement>('[data-field]');
    field.focus();
    field.value = 'half typed';

    count.value = 1;

    expect(host.get('[data-field]')).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('half typed');
    expect(host.text()).toContain('2');
  });

  it('gives each branch its own place, whichever order they are reached in', () => {
    const which = signal(0);
    let runs = 0;
    const App = component(() => () => {
      runs++;
      const n = which.value;
      if (n === 0) {
        return <b data-a>{String(n)}</b>;
      }
      if (n === 1) {
        return <i data-b>{String(n)}</i>;
      }
      return <u data-c>{String(n)}</u>;
    });
    const host = mount(() => <App />);
    const a = host.get('[data-a]');

    // A branch that is left is gone, so coming back builds it again — that is
    // what the control flow says. Nothing depends on the order they were
    // reached in: each site has its own place whether or not it was taken.
    which.value = 2;
    which.value = 1;
    which.value = 0;
    expect(host.get('[data-a]')).not.toBe(a);
    expect(host.text()).toBe('0');
    expect(runs).toBe(4);

    // Staying in a branch keeps it, which is the other half of the rule.
    const again = host.get('[data-a]');
    which.value = 0;
    expect(host.get('[data-a]')).toBe(again);
  });

  it('disposes what a branch owned when the run leaves it', () => {
    const open = signal(true);
    let made = 0;
    let gone = 0;
    const Child = component(() => {
      made++;
      onCleanup(() => {
        gone++;
      });
      return <b data-child>child</b>;
    });
    const App = component(() => () => {
      if (open.value) {
        return (
          <div>
            <Child />
          </div>
        );
      }
      return <p data-empty>nothing</p>;
    });
    const host = mount(() => <App />);
    expect(made).toBe(1);

    open.value = false;
    expect(gone).toBe(1);
    expect(host.all('[data-child]')).toHaveLength(0);

    open.value = true;
    expect(made).toBe(2);
    expect(host.all('[data-child]')).toHaveLength(1);
  });
});

describe('what the run writes and what it does not', () => {
  it('leaves a read that is not the run’s to its own scope', () => {
    const clock = signal(0);
    const profile = signal('Ada');
    let runs = 0;
    const App = component(() => () => {
      runs++;
      const who = profile.value;
      return (
        <p>
          <span data-who>{who}</span>
          <b data-clock>{String(clock.value)}</b>
        </p>
      );
    });
    const host = mount(() => <App />);
    expect(runs).toBe(1);

    // The clock is nobody's local, so it is a part: it updates without the
    // run hearing about it.
    clock.value = 1;
    expect(host.get('[data-clock]').textContent).toBe('1');
    expect(runs).toBe(1);

    // The name is the run's, so the run writes it.
    profile.value = 'Grace';
    expect(host.get('[data-who]').textContent).toBe('Grace');
    expect(runs).toBe(2);
  });

  it('writes nothing when the run produced what is already there', () => {
    const tick = signal(0);
    const App = component(() => () => {
      const label = tick.value > 100 ? 'high' : 'low';
      return <p data-out>{label}</p>;
    });
    const host = mount(() => <App />);
    const text = host.get('[data-out]').firstChild as Text;

    let writes = 0;
    let held = text.data;
    Object.defineProperty(text, 'data', {
      configurable: true,
      get: () => held,
      set: (next: string) => {
        writes++;
        held = next;
      },
    });

    tick.value = 1;
    tick.value = 2;
    expect(writes).toBe(0);

    tick.value = 200;
    expect(writes).toBe(1);
    expect(held).toBe('high');
  });

  it('replaces a handler that belongs to the run, and adds no second one', () => {
    const chosen = signal(1);
    const saved: number[] = [];
    const App = component(() => () => {
      const id = chosen.value;
      return (
        <button data-save type="button" onClick={() => saved.push(id)}>
          save
        </button>
      );
    });
    const host = mount(() => <App />);

    host.get<HTMLButtonElement>('[data-save]').click();
    chosen.value = 2;
    host.get<HTMLButtonElement>('[data-save]').click();
    chosen.value = 3;
    host.get<HTMLButtonElement>('[data-save]').click();

    // Never stale, and never doubled.
    expect(saved).toEqual([1, 2, 3]);
  });

  it('replaces a direct listener too, rather than stacking them', () => {
    const chosen = signal(1);
    const seen: number[] = [];
    const App = component(() => () => {
      const id = chosen.value;
      return (
        <div data-box onWheel={() => seen.push(id)}>
          box
        </div>
      );
    });
    const host = mount(() => <App />);

    const box = host.get('[data-box]');
    box.dispatchEvent(new Event('wheel'));
    chosen.value = 2;
    box.dispatchEvent(new Event('wheel'));
    chosen.value = 3;
    box.dispatchEvent(new Event('wheel'));

    // `wheel` is not delegated, so this is the case that would otherwise leave
    // one listener behind per run.
    expect(seen).toEqual([1, 2, 3]);
  });

  it('writes an attribute the run owns, and only when it changed', () => {
    const level = signal(1);
    const App = component(() => () => {
      const kind = level.value > 2 ? 'high' : 'low';
      return <p data-out class={kind} />;
    });
    const host = mount(() => <App />);
    const node = host.get('[data-out]');

    expect(node.getAttribute('class')).toBe('low');
    level.value = 2;
    expect(node.getAttribute('class')).toBe('low');
    level.value = 3;
    expect(node.getAttribute('class')).toBe('high');
    expect(host.get('[data-out]')).toBe(node);
  });
});

describe('what cannot be kept is built again, which is never wrong', () => {
  it('rebuilds a site whose spread belongs to the run', () => {
    const level = signal(1);
    const App = component(() => () => {
      const attrs = { title: `level ${String(level.value)}` };
      return <p data-out {...attrs} />;
    });
    const host = mount(() => <App />);
    const first = host.get('[data-out]');

    level.value = 2;
    const second = host.get('[data-out]');
    expect(second.getAttribute('title')).toBe('level 2');
    // A spread is applied once by its nature, so the site is made again
    // instead of holding the first run's object for ever.
    expect(second).not.toBe(first);
  });

  it('rebuilds a site whose keyed list belongs to the run', () => {
    const page = signal(1);
    const App = component(() => () => {
      const rows = [1, 2].map((n) => ({ id: n * page.value }));
      return (
        <ul data-list>
          {rows.map((row) => (
            <li key={row.id}>{String(row.id)}</li>
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    expect(host.text()).toBe('12');

    page.value = 2;
    expect(host.text()).toBe('24');
  });

  it('keeps a site whose keyed list is nobody’s local', () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    const title = signal('one');
    const App = component(() => () => {
      const heading = title.value;
      return (
        <ul data-list>
          <li data-title>{heading}</li>
          {rows.value.map((row) => (
            <li key={row.id}>{String(row.id)}</li>
          ))}
        </ul>
      );
    });
    const host = mount(() => <App />);
    const list = host.get('[data-list]');
    const firstRow = host.all('li')[1];

    title.value = 'two';
    expect(host.get('[data-title]').textContent).toBe('two');
    expect(host.get('[data-list]')).toBe(list);
    // The list is its own part, so the run writing the heading does not
    // disturb a single row.
    expect(host.all('li')[1]).toBe(firstRow);
  });
});

describe('what development says about a run', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('says so when a run keeps running and keeps writing nothing', () => {
    const tick = signal(0);
    const QuietRun = component(() => () => {
      // Reads something that moves, shows something that does not.
      const label = tick.value > 1000 ? 'high' : 'low';
      return <p data-quiet>{label}</p>;
    });
    mount(() => <QuietRun />);

    for (let n = 1; n <= 20; n++) {
      tick.value = n;
    }

    const said = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(said).toContain('ran 20 times and wrote nothing');
    expect(said).toContain('QuietRun');
  });

  it('says so when a child is handed a new function on every run', () => {
    const chosen = signal(1);
    const Child = component<{ readonly onSave: () => void }>((props) => (
      <button type="button" onClick={props.onSave}>
        save
      </button>
    ));
    const Parent = component(() => () => {
      const id = chosen.value;
      return <Child onSave={() => void id} />;
    });
    mount(() => <Parent />);

    chosen.value = 2;

    const said = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(said).toContain('hands a child a new function on every run');
  });
});

describe('a child a run keeps', () => {
  it('keeps its instance and only its props move', () => {
    const profile = signal({ name: 'Ada', id: 1 });
    let setups = 0;
    const Row = component<{ readonly name: string }>((props) => {
      setups++;
      return <li data-row>{props.name}</li>;
    });
    const App = component(() => () => {
      const user = profile.value;
      return (
        <ul>
          <Row name={user.name} />
        </ul>
      );
    });
    const host = mount(() => <App />);
    const row = host.get('[data-row]');

    expect(setups).toBe(1);
    expect(host.text()).toBe('Ada');

    profile.value = { name: 'Grace', id: 2 };
    expect(host.text()).toBe('Grace');
    // The same instance, the same node: only the prop moved.
    expect(setups).toBe(1);
    expect(host.get('[data-row]')).toBe(row);
  });

  it('writes a node the run chose, and leaves it alone when it did not change', () => {
    const level = signal(1);
    const App = component(() => () => {
      const high = level.value > 2;
      return <div>{high ? <b data-high>high</b> : <i data-low>low</i>}</div>;
    });
    const host = mount(() => <App />);
    const low = host.get('[data-low]');

    level.value = 2;
    expect(host.get('[data-low]')).toBe(low);

    level.value = 3;
    expect(host.all('[data-low]')).toHaveLength(0);
    expect(host.all('[data-high]')).toHaveLength(1);
  });
});

describe('a prop that did not move', () => {
  it('is not written again, so the child hears nothing', () => {
    const state = signal({ name: 'Ada', tick: 0 });
    let reads = 0;
    const Row = component<{ readonly name: string }>((props) => (
      <li data-row>
        {(() => {
          reads++;
          return props.name;
        })()}
      </li>
    ));
    const App = component(() => () => {
      const held = state.value;
      return (
        <ul data-count={String(held.tick)}>
          <Row name={held.name} />
        </ul>
      );
    });
    const host = mount(() => <App />);
    expect(reads).toBe(1);

    // The run happens again and writes the attribute, but the child's prop is
    // the string it already held, so nothing reaches the child.
    state.value = { name: 'Ada', tick: 1 };
    expect(host.get('ul').getAttribute('data-count')).toBe('1');
    expect(reads).toBe(1);

    state.value = { name: 'Grace', tick: 2 };
    expect(reads).toBe(2);
  });
});
