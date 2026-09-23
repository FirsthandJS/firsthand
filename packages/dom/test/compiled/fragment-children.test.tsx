/**
 * What a run keeps when what it returns is a fragment.
 *
 * A component a run returns on its own is made once and handed back on every
 * run. Inside a fragment it was not: the array and the parts in it are built
 * again each time, and the compiler read the part's thunk as a scope of its
 * own — so the component, and everything under it, was rebuilt on every run
 * (#47). These are the assertions that say it is the same component, which is
 * the part a test on the text alone cannot see.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, signal, type View } from '@firsthandjs/dom';

afterEach(cleanup);

type FrameProps = { readonly label?: string; readonly children?: View };

/* The cast is the types-only gap `children-of-a-run.test.tsx` describes. */
const Frame = component<FrameProps>((props) => (
  <section>
    <b>{props.label ?? ''}</b>
    {props.children as View}
  </section>
));

describe('a component inside a fragment a run returns', () => {
  it('is the same element after the run happens again', () => {
    const count = signal(0);
    const Panel = component(() => () => (
      <>
        <Frame label={`n=${String(count.value)}`} />
        <p>after</p>
      </>
    ));
    const view = mount(() => <Panel />);
    const first = view.get('section');

    count.value = 1;
    expect(view.get('section')).toBe(first);
    expect(view.text()).toContain('n=1');
  });

  it('is made once, however often the run happens', () => {
    const count = signal(0);
    let made = 0;
    const Once = component(() => {
      made += 1;
      return <i>once</i>;
    });
    const Panel = component(() => () => (
      <>
        <Once />
        <p>{String(count.value)}</p>
      </>
    ));
    mount(() => <Panel />);

    expect(made).toBe(1);
    count.value = 1;
    count.value = 2;
    expect(made).toBe(1);
  });

  it('keeps the state the component holds of its own', () => {
    // The consequence a user sees: a rebuilt child loses what it was doing.
    const count = signal(0);
    const Counter = component(() => {
      const own = signal(0);
      return <button onClick={() => (own.value += 1)}>{String(own.value)}</button>;
    });
    const Panel = component(() => () => (
      <>
        <Counter />
        <p>{String(count.value)}</p>
      </>
    ));
    const view = mount(() => <Panel />);

    view.get('button').click();
    expect(view.get('button').textContent).toBe('1');
    count.value = 1;
    expect(view.get('button').textContent).toBe('1');
  });

  it('is fed a run local through a cell, like a child anywhere else', () => {
    const count = signal(0);
    const Panel = component(() => () => {
      const n = `n=${String(count.value)}`;
      return (
        <>
          <Frame label={n}>{n}</Frame>
        </>
      );
    });
    const view = mount(() => <Panel />);
    const first = view.get('section');

    count.value = 1;
    expect(view.get('section')).toBe(first);
    expect(view.text()).toContain('n=1');
  });

  it('is remade when the run leaves the branch and comes back, like anywhere else', () => {
    // Not a property of fragments: a site belongs to the branch that reached
    // it, and a run that returned something else let go of what was there. A
    // component the run returns on its own does exactly the same, and this is
    // here so the two shapes cannot drift apart.
    const status = signal('ready');
    const Panel = component(() => () => {
      if (status.value === 'loading') {
        return <i>loading</i>;
      }
      return (
        <>
          <Frame label="body" />
        </>
      );
    });
    const view = mount(() => <Panel />);
    const first = view.get('section');

    status.value = 'loading';
    expect(view.text()).toContain('loading');
    status.value = 'ready';
    expect(view.get('section')).not.toBe(first);
    expect(view.text()).toContain('body');
  });

  it('keeps the frame and its rows when the run is over a local of its own', () => {
    // The shape #47 was measured in: a board, a fragment, a frame around a
    // keyed list, and one card moving. Before the fix every card, every lane
    // and the frame around them were replaced on a change that moved one.
    const board = signal({
      cards: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
    });
    const Card = component<{ readonly title: string }>((props) => <li>{props.title}</li>);
    const Panel = component(() => () => {
      const cards = board.value.cards;
      return (
        <>
          <h1>board</h1>
          <Frame>
            {cards.map((card) => (
              <Card key={card.id} title={card.title} />
            ))}
          </Frame>
        </>
      );
    });
    const view = mount(() => <Panel />);
    const frame = view.get('section');
    const [first] = view.all('li');

    board.value = {
      cards: [
        { id: 2, title: 'b' },
        { id: 1, title: 'a' },
      ],
    };
    expect(view.get('section')).toBe(frame);
    expect(view.all('li')[1]).toBe(first);
    expect(view.text()).toContain('b');
  });
});

describe('what a fragment does not keep', () => {
  it('makes a list row per row rather than once per run', () => {
    // The distinction the fix turns on: a fragment's own child is reached on
    // every run, a row inside a list is reached per row and belongs to the
    // callback the author wrote.
    const rows = signal([1, 2]);
    const Row = component<{ readonly n: number }>((props) => <li>{String(props.n)}</li>);
    const Panel = component(() => () => (
      <>
        <ul>
          {rows.value.map((n) => (
            <Row key={n} n={n} />
          ))}
        </ul>
      </>
    ));
    const view = mount(() => <Panel />);
    expect(view.text()).toContain('1');
    expect(view.text()).toContain('2');

    rows.value = [1, 2, 3];
    expect(view.all('li')).toHaveLength(3);
    expect(view.text()).toContain('3');
  });

  it('keeps the rows it already had when the list grows', () => {
    const rows = signal([1, 2]);
    const Row = component<{ readonly n: number }>((props) => <li>{String(props.n)}</li>);
    const Panel = component(() => () => (
      <>
        <ul>
          {rows.value.map((n) => (
            <Row key={n} n={n} />
          ))}
        </ul>
      </>
    ));
    const view = mount(() => <Panel />);
    const [one, two] = view.all('li');

    rows.value = [1, 2, 3];
    expect(view.all('li')[0]).toBe(one);
    expect(view.all('li')[1]).toBe(two);
  });
});
