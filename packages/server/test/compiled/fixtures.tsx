/**
 * One component per shape the compiler can emit.
 *
 * This file is compiled twice: once as written, for the browser, and once
 * through `?server`, for markup. Nothing in here is written for one of the two
 * — that is the point. Whatever the parity suite finds here it renders both
 * ways and compares, so a shape that only works in a browser fails as a test
 * rather than as somebody's blank page.
 */
import { component, createContext, provide, signal, useContext, type View } from '@firsthandjs/dom';
import { DataContext, useResource, type DataStore } from '@firsthandjs/data';

export const Plain = component(() => <p class="lead">Hello</p>);

export const Void = component(() => (
  <div>
    <br />
    <img src="/logo.png" alt="Logo" />
    <hr />
  </div>
));

export const Nested = component(() => (
  <section>
    <h1>Title</h1>
    <p>
      Some <em>emphasis</em> and more.
    </p>
  </section>
));

export const Text = component((props: { readonly name: string }) => <p>Hello, {props.name}!</p>);

export const Escaping = component((props: { readonly raw: string }) => (
  <p title={props.raw}>{props.raw}</p>
));

export const ManyHoles = component((props: { readonly a: string; readonly b: string }) => (
  <p>
    {props.a}
    {props.b}
  </p>
));

export const Attributes = component(
  (props: {
    readonly title: string;
    readonly id: string;
    readonly missing: string | undefined;
  }) => (
    <div title={props.title} data-id={props.id} lang={props.missing}>
      text
    </div>
  ),
);

export const Namespaced = component((props: { readonly value: string }) => (
  <div attr:data-x={props.value} prop:className={props.value}>
    text
  </div>
));

export const Classes = component(
  (props: { readonly names: Record<string, boolean>; readonly list: readonly string[] }) => (
    <div>
      <span class={props.names} />
      <span class={props.list} />
      <span class="static" />
    </div>
  ),
);

export const Styles = component(
  (props: { readonly style: Record<string, string>; readonly text: string }) => (
    <div>
      <span style={props.style} />
      <span style={props.text} />
    </div>
  ),
);

export const Booleans = component((props: { readonly on: boolean; readonly off: boolean }) => (
  <fieldset disabled={props.off}>
    <input type="checkbox" checked={props.on} readOnly={props.on} />
    <button disabled={props.on}>Go</button>
  </fieldset>
));

export const Fragments = component((props: { readonly items: readonly string[] }) => (
  <div>
    <>
      <span>one</span>
      <span>two</span>
    </>
    {props.items.map((item) => (
      <b>{item}</b>
    ))}
  </div>
));

export const Keyed = component((props: { readonly items: readonly string[] }) => (
  <ul>
    {props.items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
));

const Child = component((props: { readonly label: string }) => <em>{props.label}</em>);

export const Composed = component((props: { readonly label: string }) => (
  <div>
    <Child label={props.label} />
    <Child label="static" />
  </div>
));

type SlottedProps = { readonly children?: View };

/*
 * The cast is a types-only gap, not a runtime one: `ReadonlyProps` descends
 * into `View`'s dynamic-child member, which carries an owner, and a deeply
 * readonly owner is no longer one. `insert(node, () => props.children)` is the
 * way around it today; see the note in `docs/reference/dom.md`.
 */
const Slotted = component<SlottedProps>((props) => <aside>{props.children as View}</aside>);

export const WithChildren = component((props: { readonly label: string }) => (
  <Slotted>
    <span>{props.label}</span>
  </Slotted>
));

/* A plain function returning markup: the compiler marks it as a view. */
const Label = (props: { readonly text: string }): View => <strong>{props.text}</strong>;

export const WithView = component((props: { readonly text: string }) => (
  <div>
    <Label text={props.text} />
  </div>
));

export const Render = component((props: { readonly label: string }) => {
  const count = signal(2);
  return () => {
    const shown = `${props.label}: ${count.value}`;
    return (
      <div>
        <span>{shown}</span>
        <button onClick={() => (count.value += 1)}>+</button>
      </div>
    );
  };
});

export const Branch = component((props: { readonly wide: boolean }) => () => {
  if (props.wide) {
    return <div class="wide">wide</div>;
  }
  return <div class="narrow">narrow</div>;
});

const Theme = createContext<string>('theme');

export const Provider = component((props: { readonly theme: string }) => {
  provide(Theme, props.theme);
  return (
    <div>
      <Themed />
    </div>
  );
});

const Themed = component(() => <span>{useContext(Theme).value}</span>);

export const Spread = component((props: { readonly attributes: Record<string, unknown> }) => (
  <div {...props.attributes}>text</div>
));

export const Conditional = component((props: { readonly show: boolean }) => (
  <div>{props.show ? <span>yes</span> : null}</div>
));

export const Nothing = component(() => (
  <p>
    {null}
    {undefined}
    {false}
    {0}
  </p>
));

export const RunChild = component((props: { readonly label: string }) => {
  const count = signal(1);
  return () => {
    const label = `${props.label} ${count.value}`;
    return (
      <div>
        <Child label={label} />
        <button onClick={() => (count.value += 1)}>+</button>
      </div>
    );
  };
});

export const RunList = component((props: { readonly items: readonly string[] }) => {
  const suffix = signal('!');
  return () => (
    <ul class={suffix.value === '!' ? 'loud' : 'quiet'}>
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
});

export const ListOfComponents = component((props: { readonly items: readonly string[] }) => (
  <div>
    {props.items.map((item) => (
      <Child key={item} label={item} />
    ))}
  </div>
));

/**
 * A row whose setup returns a render function, mapped over a list.
 *
 * The combination is what the example projects are written in and what the
 * pieces above only cover apart: a list position whose items are components,
 * each of which hands back a function rather than a tree. The list has to
 * unwrap that function *and* hand it the markup the server sent for that row.
 */
const Row = component((props: { readonly label: string }) => () => <li>{props.label}</li>);

export const ListOfRenderComponents = component((props: { readonly items: readonly string[] }) => (
  <ul>
    {props.items.map((item) => (
      <Row key={item} label={item} />
    ))}
  </ul>
));

/**
 * The shape an application is actually written in.
 *
 * A setup that returns a render function, which returns a fragment: something
 * before the list, the list itself, and a conditional after it — with the rows
 * being components whose setups return render functions too. Each piece is
 * covered above on its own; together they are what a page looks like, and the
 * page is where they first went wrong.
 */
const Line = component((props: { readonly label: string; readonly busy: boolean }) => () => (
  <li class={props.label === '' ? 'line empty' : 'line'}>
    <span>{props.label}</span>
    <button type="button" disabled={props.busy}>
      Mark
    </button>
  </li>
));

export const Page = component((props: { readonly items: readonly string[] }) => {
  const query = signal('');
  return () => {
    const shown = props.items.filter((item) => item.includes(query.value));
    return (
      <>
        <label class="filter">
          <span>Filter</span>
          <input
            value={query.value}
            onInput={(event) => {
              query.value = (event.target as HTMLInputElement).value;
            }}
          />
          <span class="left">{shown.length} shown</span>
        </label>
        <ul class="lines">
          {shown.map((item) => (
            <Line key={item} label={item} busy={false} />
          ))}
        </ul>
        {shown.length === 0 ? <p class="empty">Nothing matches.</p> : null}
      </>
    );
  };
});

export const Deep = component((props: { readonly label: string }) => (
  <main>
    <Composed label={props.label} />
    <WithView text={props.label} />
    <Conditional show={props.label !== ''} />
  </main>
));

const Greeting = component((props: { readonly load: () => Promise<string> }) => {
  const greeting = useResource(async () => props.load(), { persist: 'greeting' });
  return () => {
    const value = greeting.data.value;
    return value === undefined ? <p class="wait">loading</p> : <p class="done">{value}</p>;
  };
});

export const Loaded = component(
  (props: { readonly store: DataStore; readonly load: () => Promise<string> }) => {
    provide(DataContext, props.store);
    return <Greeting load={props.load} />;
  },
);

const Empty = component((props: { readonly label: string }) =>
  props.label === '' ? null : <em>{props.label}</em>,
);

export const RunNothing = component((props: { readonly label: string }) => {
  const shown = signal(false);
  return () => {
    const label = `${props.label}${shown.value ? '!' : ''}`;
    return (
      <div>
        {shown.value ? label : null}
        <Empty label={shown.value ? label : ''} />
      </div>
    );
  };
});

export const RunElement = component((props: { readonly label: string }) => {
  const on = signal(true);
  return () => {
    // A run-local holding markup: the run writes the node it names, rather
    // than the position becoming a part of its own.
    const shown = on.value ? <span>{props.label}</span> : <b>{props.label}</b>;
    return <div>{shown}</div>;
  };
});

const Pair = component((props: { readonly label: string }) => (
  <>
    <i>{props.label}</i>
    <u>{props.label}</u>
  </>
));

export const RunPair = component((props: { readonly label: string }) => {
  const count = signal(1);
  return () => {
    const label = `${props.label}${String(count.value)}`;
    return (
      <div>
        <Pair label={label} />
        <hr />
      </div>
    );
  };
});

/*
 * A component whose setup returns a render function, used as somebody else's
 * child. The child position is a region, and what it holds belongs to the
 * render function's part rather than to the part that produced it — which is
 * the difference between adopting the page and rebuilding it.
 */
const Panel = component((props: { readonly label: string }) => {
  const open = signal(true);
  return () => (
    <>
      <h3>{props.label}</h3>
      {open.value ? <p>shown</p> : null}
    </>
  );
});

export const NestedRun = component((props: { readonly label: string }) => (
  <section>
    <Panel label={props.label} />
    <Panel label="second" />
  </section>
));
