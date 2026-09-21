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
is what reading a value does. The next section is about that, because it is the
one place where the model surprises people.

## Setup runs once, so a value you read is a value you keep

The setup function runs exactly once per instance. It decides what to build and
wires up the parts that change; nothing re-runs it. Everything good about the
model follows from that — and so does the one mistake worth knowing in advance,
because it produces a wrong value rather than an error.

In a framework that re-renders, reading a value and using it are the same act:
the function runs again, so what you read is fresh again. Here they are two
different acts. Reading is a moment; staying current means reading _in a place
the framework will read again_.

```tsx
const Widget = component<{ items: Item[] }>((props) => {
  const count = props.items.length; // read once, at setup
  return <p>{count} items</p>; // and so this number never changes
});
```

```tsx
const Widget = component<{ items: Item[] }>((props) => (
  <p>{props.items.length} items</p> // read where it is shown: always current
));
```

Signals behave the same way, for the same reason — `.value` is a read:

```tsx
const doubled = count.value * 2; // a number, worked out once
const doubled = computed(() => count.value * 2); // a cell, always current
<p>{count.value * 2}</p>; // inside a part: always current
```

The whole rule in one line: **in setup you choose what to build; in a part, an
event handler, an `effect` or a `computed` you choose what to read.**

### What it looks like when it happens

Nothing throws, which is exactly why it is worth recognising:

- a number or a label that is right at first and then stops moving
- a handler that acts on the row the list held when it was built
- a class or a style stuck at its first value while the state behind it changes
- a `console.log` in setup that prints once and convinces you the data is wrong
  when it is only old

The fix is always the same shape: move the read inside the thing that should
re-read it.

```tsx
const Row = component<{ todo: Todo }>((props) => {
  const done = props.todo.done; // frozen
  return <li class={done ? 'done' : ''}>{props.todo.title}</li>;
});

const Row = component<{ todo: Todo }>((props) => (
  // the class is a part now, so it is re-read when `done` changes
  <li class={() => (props.todo.done ? 'done' : '')}>{props.todo.title}</li>
));
```

### When a snapshot is the point

Reading once is not a mistake in itself — sometimes it is exactly what you
mean, and then setup is the right place for it:

```tsx
const Form = component<{ initial: string }>((props) => {
  // The starting value of an editable field. It should *not* follow the prop:
  // that would overwrite what the person is typing.
  const draft = signal(snapshot(() => props.initial));

  return <input value={draft.value} onInput={(e) => (draft.value = e.currentTarget.value)} />;
});
```

Both readings are legitimate. The difference is whether you meant it, and
[`snapshot`](../reference/core.md#snapshot) is how you say so — to the next
reader, and to the check below.

### Having the machine say it

Since reading once is legal, nothing can reject it outright. What
[`setStrictReactivity(true)`](../reference/core.md#setstrictreactivity) does is
report it during development: a signal or prop read in a component body with
nothing subscribing gets one line on the console, naming the fix. It is off by
default, it says nothing inside `snapshot()` or `peek()`, and it costs nothing
in a production build — the whole check is replaced by an empty function there.

```ts
if (import.meta.env.DEV) {
  setStrictReactivity(true);
}
```

## A view is chosen in the markup, not before it

A setup runs **once**, which makes this wrong in a way that compiles:

```tsx
const Panel = component(() => {
  const open = signal(false);
  return open.value ? <Form /> : <Button />; // decided now, and never again
});
```

Whichever branch was true while the component was being built is the only one
that will ever be on screen. The same thing spelled with a keyword is the same mistake, and it is the one
that turns up in a route guard:

```tsx
const Guarded = component(() => {
  if (token.value === null) {
    return <Navigate to="/sign-in" />; // never runs again; a sign-out leaves
  } // the page it was hiding on screen
  return <Page />;
});
```

Put the choice where it can run again — in a child
position, where it is a part:

```tsx
return <>{open.value ? <Form /> : <Button />}</>;
```

The compiler reports the first form as a build error (`strictReactivity`),
because nothing throws at runtime: the button simply stops working, later, and
it takes twenty minutes to find.

It reports a **signal** read and not a prop read. A signal exists in order to
change; a prop may be fixed for the life of an instance — a recursive
`component((props) => (props.depth === 0 ? <Leaf /> : <Nested />))` decides its
shape once and is right to — and the compiler cannot tell the two apart. Where
a prop does change, the same rule applies and nobody will warn you.

It also looks for `.value` in the source, which is the other thing worth
knowing: a [`deepSignal`](../reference/deep.md) is read without it, so

```tsx
return state.open ? <Form /> : <Button />; // just as wrong, and not reported
```

goes through. The check catches an important class of this mistake rather than
all of it. The rule to carry is the one at the top of this section — a view is
chosen in the markup — and the compiler is a second pair of eyes on it, not a
proof.

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

## Starting an instance over

A component body runs once, which leaves one honest question: what if you want
it to run again — to throw away everything it set up and start clean, the way a
changing `key` resets a component in a re-rendering framework?

You replace the instance rather than re-render it, and the spelling is the one
you already know:

```tsx
// A key that changes: new key, new instance.
{
  [draftId.value].map((id) => <Editor key={id} draft={id} />);
}
```

Or, for a single component, read a version signal in the child position that
holds it:

```tsx
const version = signal(0);

<div>{(version.value, (<Editor initial="hello" />))}</div>;

// Anywhere: a fresh Editor, with its own state.
version.value++;
```

Both do the same thing: the part re-evaluates, the old instance is **disposed**
— its cleanups run, its effects unsubscribe, its DOM is removed — and a new one
is created in its place. Nothing is diffed and nothing is reused.

What does _not_ do this is a prop change. `<Label text={text.value} />` keeps
one instance and one element for the life of the parent, and only rewrites the
text node; that is the ordinary path, and re-creation is a decision you make
explicitly.

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
| Key-based remounting               | `key` on a list row, or a version signal — see above |

One row has no entry, and it is the one that costs people time: there is no
equivalent of "the body runs again". In a re-rendering framework the body is
where you read current values, because it is re-entered. Here the body is where
you decide the shape, and the parts are where values are read. A habit that was
correct — read at the top, use below — is what produces a frozen value here, so
it is worth re-reading
[Setup runs once](#setup-runs-once-so-a-value-you-read-is-a-value-you-keep)
after your first component rather than before it.

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
