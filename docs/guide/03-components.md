# Components

[Index](../README.md) · Previous: [Reactivity](02-reactivity.md) · Next:
[Rendering](04-rendering.md)

---

A component is a function that builds DOM once and wires up the parts that
change.

```tsx
const Greeting = component<{ name: string }>((props) => <p>Hello {props.name}</p>);
```

`component()` returns something you can use as an element — `<Greeting
name="Ada" />` — or call directly — `Greeting({ name: 'Ada' })`. They are the
same thing; the first compiles to the second.

## Props are live reads

Props are accessor properties over the caller's values. Reading one inside a
reactive position subscribes to whatever the caller read:

```tsx
const Parent = component(() => {
  const name = signal('Ada');
  return <Greeting name={name.value} />; // reading `name` here...
});

// ...means `props.name` in Greeting is current, without Greeting re-running.
```

Two consequences worth internalising:

**Nothing is copied.** The object you pass is the object the component gets:
same reference, no serialisation, no cloning. A prop may be a class instance, a
`Map`, a DOM node, a function.

**Reading a prop outside a reactive position takes a snapshot**, because that
is what reading a value does:

```tsx
const Widget = component<{ items: Item[] }>((props) => {
  const first = props.items[0]; // read once, at setup — probably not what you want
  return <p>{props.items.length}</p>; // read in a part — updates
});
```

## Destructuring works

```tsx
const Row = component<{ todo: Todo; onToggle: () => void }>(({ todo, onToggle }) => (
  <li onClick={onToggle}>{todo.title}</li>
));
```

The compiler rewrites destructured props into live reads, so `todo.title` above
is re-read when it changes. Defaults are re-applied per read rather than
captured once:

```tsx
const Badge = component<{ count?: number }>(({ count = 0 }) => <b>{count}</b>);
```

Rest works too, and stays live:

```tsx
const Input = component<{ label: string } & DomProps>(({ label, ...rest }) => (
  <label>
    {label}
    <input {...rest} />
  </label>
));
```

## Props are readonly

```tsx
props.name = 'Grace'; // type error, and the object is frozen at runtime
```

A component does not own its props. To change what a parent shows, call
something the parent gave you.

## Children

```tsx
const Panel = component<{ children?: View }>((props) => (
  <section class="panel">{props.children}</section>
));

<Panel>
  <p>Anything</p>
</Panel>;
```

Children are ordinary DOM by the time the component sees them, except for
dynamic ones, which arrive as deferred parts and are bound when inserted. You
do not need to know that unless you are writing something that adopts children
into a foreign tree — see [React interop](11-react-interop.md).

## Component identity

`component()` takes optional metadata that the compiler fills in:

```tsx
component(setup, options, id, name);
```

The compiler gives every component a **stable build id** derived from your
package name and file path, rather than relying on `Function.name`, which
minifiers rewrite. That id is what makes custom element names and devtools
labels survive a production build
([ADR-0004](../adr/0004-component-identity-without-name-strings.md)).

An element type that is _not_ a Firsthand component — a React component, say —
throws `FirsthandComponentError` unless an adapter has been installed for it. That
is what `@firsthandjs/react/auto` does, and it is the only thing in the framework
that knows other frameworks exist
([React interop](11-react-interop.md), [ADR-0017](../adr/0017-foreign-element-types.md)).

## Custom elements

Components are hostless by default: `<Counter />` produces the elements the
component returned, with no wrapper. Opt into a real custom element when you
want one:

```tsx
const UserCard = component(setup, { tag: true }); // <my-app-user-card>
const Widget = component(setup, { shadow: true }); // + a shadow root
```

The tag name is derived from the binding name and your `packageName`, so there
is no name string to repeat. Measured cost: about 1.5× mount time and twice the
node count, which is why it is opt-in
([ADR-0003](../adr/0003-hostless-components-with-optional-custom-element.md)).
More in [Web components](10-web-components.md).

## What replaces the things you are used to

| In a re-rendering framework        | Here                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| `useState`                         | `signal`, anywhere, in any order                     |
| `useMemo`                          | `computed`, or nothing — the body does not re-run    |
| `useCallback`                      | Nothing. A function created in setup is created once |
| `memo()` / `shouldComponentUpdate` | Nothing. A parent's change does not re-run a child   |
| `useEffect(fn, deps)`              | `effect(fn)` — dependencies are observed             |
| `useRef` for a mutable box         | A plain `let`, or a `signal` if the view reads it    |
| `useRef` for an element            | `ref={(element) => …}`                               |
| Key-based remounting               | `key` on a list row; or render a different component |

## A worked example

```tsx
const TodoList = component<{ todos: Todo[] }>((props) => {
  const filter = signal<'all' | 'open'>('all');

  // Derived, lazy, memoised — and recomputed only when the filter or the
  // todos actually change.
  const shown = computed(() =>
    filter.value === 'all' ? props.todos : props.todos.filter((todo) => !todo.done),
  );

  return (
    <section>
      <button onClick={() => (filter.value = filter.value === 'all' ? 'open' : 'all')}>
        Showing: {filter.value}
      </button>

      <ul>
        {shown.value.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </ul>

      <p>{shown.value.length} shown</p>
    </section>
  );
});
```

Clicking the button rewrites one text node, reconciles the list, and rewrites
the count. `TodoList` does not run again; neither does any `TodoRow` whose data
did not change.

---

Next: [Rendering](04-rendering.md) — conditionals, lists, fragments and
portals.
