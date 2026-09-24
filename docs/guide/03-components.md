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

## Choosing a view

A setup runs **once**, which makes this wrong in a way that compiles:

```tsx
const Panel = component(() => {
  const open = signal(false);
  return open.value ? <Form /> : <Button />; // decided now, and never again
});
```

Whichever branch was true while the component was being built is the only one
that will ever be on screen. The same thing spelled with a keyword is the same
mistake, and it is the one that turns up in a route guard:

```tsx
const Guarded = component(() => {
  if (token.value === null) {
    return <Navigate to="/sign-in" />; // never runs again; a sign-out leaves
  } // the page it was hiding on screen
  return <Page />;
});
```

There are two ways to fix it, and they are the two halves of the same rule.

**Put the choice in the markup**, where it is a part:

```tsx
return <>{open.value ? <Form /> : <Button />}</>;
```

**Or return a render function**, which is a reactive scope of its own and may
use ordinary control flow:

```tsx
const Guarded = component(() => () => {
  if (token.value === null) {
    return <Navigate to="/sign-in" />;
  }
  return <Page />;
});
```

The compiler reports the broken form as a build error (`strictReactivity`) and
offers both, because nothing throws at runtime: the button simply stops
working, later, and it takes twenty minutes to find.

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
all of it, and the section below is the rule it is a second pair of eyes on.

## Functions are the unit of reactive work

Everything in this framework is one rule, said once:

> **Every function you write is a reactive scope: it runs again when something
> it read changes. JSX beneath it makes the smallest scopes it can — as long
> as they need nothing from the run that made them.**

`computed`, `effect` and `useResource` are that rule. So is a render function,
one level up. There is no second rendering model to learn, and no keyword: the
shape of your functions _is_ the shape of the reactive graph.

### Three shapes, and what each one is for

```tsx
// 1. A view function: markup, no state.
function Badge({ kind }: { kind: string }) {
  return <span class={kind}>{kind}</span>;
}

// 2. A component: it has a setup, so it can hold something.
const Counter = component(() => {
  const count = signal(0);
  return <button onClick={() => count.value++}>{count.value}</button>;
});

// 3. A component with a render function: the setup holds, the run decides.
const Panel = component(() => {
  const open = signal(false);
  return () => {
    if (!open.value) {
      return <Closed onOpen={() => (open.value = true)} />;
    }
    return <Form />;
  };
});
```

Read them as a progression rather than as alternatives:

- **`component()` means "this view needs a setup"** — a signal, an effect, a
  resource, a context value. Without one, a function is enough.
- **The arrow means "this view has statements"** — an `if`, a value derived
  from several reads. Without them, returning the markup is enough, and shape 2
  is exactly shape 3 with an empty body.

Nothing about shape 2 has changed, and an application that never writes an
arrow never meets any of what follows.

## What belongs to a run, and what does not

Inside a render function, the compiler asks one question of every expression in
the markup: **does it name something the run made?**

```tsx
return () => {
  const user = profile.value;

  return (
    <article class={user.kind}>
      <h1>{user.name}</h1> {/* names `user` — the run writes it */}
      <time>{clock.value}</time> {/* names nothing of the run's — its own part */}
      <Footer /> {/* nothing of the run's — made once */}
    </article>
  );
};
```

This is not an optimisation the compiler chooses; it is the only thing it can
do. `user` belongs to _this_ call of the run — a part that captured it would
hold a value from a run that is over. `clock` belongs to nobody, so a part can
read it for ever, and does: **the clock ticks without waking the run at all.**

Three consequences worth holding on to:

| Where you read it                    | What happens                              |
| ------------------------------------ | ----------------------------------------- |
| In a statement                       | the whole run happens again               |
| In the markup, from a signal or prop | that one site updates; the run sleeps     |
| In the markup, from a run local      | the run writes it, and only if it changed |
| As a keyed list's data, from a local | the list is made once and reconciles      |
| As a prop or a child, from a local   | the child keeps its instance              |

The last three are the same mechanism: anything a run hands to something built
once goes through a cell the run writes, so what was made survives and only
what changed is written. A keyed list over a run local therefore keeps its
rows — it did not always, which was
[issue #40](https://github.com/FirsthandJS/firsthand/issues/40).

You choose between the first two by where you put a normal JavaScript line:

```tsx
// Twenty sites, twenty scopes, each reading `profile` for itself.
return () => (
  <dl>
    <dt>{profile.value.name}</dt>
    <dd>{profile.value.email}</dd>
    {/* … */}
  </dl>
);

// One scope: read once, derive once, write what moved.
return () => {
  const person = profile.value;
  return (
    <dl>
      <dt>{person.name}</dt>
      <dd>{person.email}</dd>
      {/* … */}
    </dl>
  );
};
```

Both are correct. The second is the one to reach for when the sites share a
source, and it is measurably cheaper — see
[Performance](15-performance.md#render-functions).

## What a run does to the DOM

**A site is made once and written afterwards.** The markup in a run is not
rebuilt when the run happens again; the same nodes are written into, and a
value that has not changed is not written at all.

That is worth more than the speed. It is why this keeps working:

```tsx
return () => {
  const total = price.value * quantity.value;
  return (
    <form>
      <input name="note" />
      <output>{total}</output>
    </form>
  );
};
```

A price change runs the function again, and the `<input>` keeps its focus, its
caret and whatever was half typed into it — because it is the same element.

**A branch the run leaves is gone, not hidden.** When the run stops returning
a piece of markup, that piece is disposed: its components run their cleanups,
its parts stop, its nodes are removed. Coming back builds it again.

```tsx
return () => {
  if (editing.value) {
    return <Editor draft={draft} />; // disposed when editing ends
  }
  return <Preview />; // and built again when it starts
};
```

That is what the control flow says, so it is what happens. Nothing is kept
alive off-screen, and no state survives a branch it was not in.

### Identity

A site is identified by **where it stands in the source**. That is enough for
markup that appears once — including markup inside an `if`, which is the thing
hook rules cannot do: each branch has its own place whether or not it was
taken, and nothing depends on the order the run reached them in.

Markup that appears _many_ times from one place needs a key, and the compiler
insists:

```tsx
return () => {
  const rows = table.value.rows;
  return (
    <ul>
      {rows.map((row) => (
        <Row key={row.id} row={row} /> // without `key`: a build error
      ))}
    </ul>
  );
};
```

### Children keep their instance

A component written inside a run is made **once**. When the run happens again
it is handed the same instance, and only its props move:

```tsx
return () => {
  const user = profile.value;
  return <UserCard name={user.name} email={user.email} />;
};
```

`UserCard`'s setup runs once, its state survives, and a prop whose value did
not change does not reach it at all. Props fed from a run are held in cells for
exactly this reason; a prop that is not — `<UserCard name={profile.value.name} />`
— stays an ordinary live read and costs nothing extra.

### Handlers are what they look like

```tsx
return () => {
  const user = profile.value;
  return <button onClick={() => save(user.id)}>Save</button>;
};
```

Normal JavaScript makes a new closure on every run, and that is exactly what
happens: the new one replaces the old one on the node. **It is never stale** —
the handler is always as old as the DOM beside it, because the same run wrote
both. If the button says "Grace", it saves Grace.

The one thing to know is what that costs when the handler goes to a _child_:

```tsx
return () => {
  const user = profile.value;
  return <UserCard user={user} onSave={() => save(user.id)} />;
};
```

A new function is never equal to the one before it, so `UserCard` runs again
whenever its parent does. If the handler does not need the run, define it in
the setup, where it is made once:

```tsx
const save = () => saveUser(profile.peek().id);
return () => <UserCard user={profile.value} onSave={save} />;
```

Development says so when it happens, rather than leaving you to find it.

## Where the framework stops helping

A render function is one scope, so everything in its body runs when anything in
its body changes. That is the whole model, and it has one sharp edge:

```tsx
return () => {
  const sorted = expensiveSort(rows.value); // expensive
  const label = `Page ${String(page.value)}`; // cheap, changes often
  return (
    <>
      <h2>{label}</h2>
      <Table rows={sorted} />
    </>
  );
};
```

Every page change sorts again. In the fine-grained shape the framework hoists
that for you, because the sort is its own part; here you say it yourself, with
the tool that has always been there:

```tsx
const sorted = computed(() => expensiveSort(rows.value)); // setup

return () => {
  const label = `Page ${String(page.value)}`;
  return (
    <>
      <h2>{label}</h2>
      <Table rows={sorted.value} />
    </>
  );
};
```

Now the source says what depends on what: the sort depends on the rows, the run
depends on the page. **Drawing the reactive graph with function boundaries is
the point of the whole model** — this is the same act as choosing where to put
`const user = profile.value`, one level further out.

You are told when you get it wrong. A run that keeps running and keeps writing
nothing is doing work for nobody, and development says so in as many words:

```
<OrderTable> ran 20 times and wrote nothing.
Something it reads in a statement changes more often than what it shows. Move
that read into the markup, where it is a part of its own, or move the
derivation into a computed in the setup.
```

Nothing is optimised behind your back — it is bookkeeping, said out loud.

## Two things a render function may not do

Both are compiler errors, and both are the same rule as everywhere else.

**Nothing persistent is made in a run.** A signal, a computed, an effect, a
resource — anything that outlives the moment it was made belongs in the setup,
which runs once:

```tsx
component(() => {
  const draft = signal(''); // here

  return () => {
    const draft = signal(''); // not here: a build error
    return <input value={draft.value} />;
  };
});
```

This is not a rule about ordering, and there is nothing to keep in the same
sequence between runs. It is one sentence: **persistent things are made in the
setup.**

**Repeated markup carries a key**, as above. Where markup stands answers for
one of it; only a key answers for many.

## View functions

A function that returns markup is a view, and a view is a reactive scope like
any other. It needs no `component()`, because it has nothing to hold:

```tsx
function Money({ amount }: { amount: number }) {
  return <span class={amount < 0 ? 'debit' : 'credit'}>{amount.toFixed(2)}</span>;
}

// Used as a tag, it is a scope of its own: it runs again when what it read
// changes, and nothing else on the page is disturbed.
<Money amount={balance.value} />;
```

Writing it as a **tag** is what gives it a place and a scope. Calling it is
just a function call, and behaves like one:

```tsx
{
  Money({ amount: 5 });
} // a call: runs where you wrote it, builds markup
<Money amount={5} />; // a site: its own scope, its own place
```

Both are legitimate and the difference is visible, which is the point. Reach
for the tag when the thing should be able to update on its own; call it when
you are just building some markup in passing.

A view function has no setup, so it may not make anything persistent — the same
error as above, with the same fix: give it a `component()` when it needs to
hold something.

## Which one should you write?

| You need                                        | Write                     |
| ----------------------------------------------- | ------------------------- |
| markup, nothing held                            | a view function           |
| state, an effect, a resource, context           | `component()`             |
| an `if`, an early return, a guard               | a render function         |
| a value several sites share                     | a statement in the run    |
| a value one site uses                           | the read, in the markup   |
| a derivation that must not re-run with the rest | a `computed` in the setup |
| the same markup many times                      | `key`                     |

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

A default answers for `undefined` and nothing else, as it does in the language:
`<Badge count={null} />` shows `null`, not `0`. That matters when the value
comes from an API, where `null` usually means "known to be empty" and is not
the same answer as "not given".

Rest works too, and stays live:

```tsx
const Input = component<{ label: string } & DomProps>(({ label, ...rest }) => (
  <label>
    {label}
    <input {...rest} />
  </label>
));
```

A spread will not write an event handler as an attribute. `onClick={handler}`
is a listener and always was; a key spelled `onmouseover`, `onerror` or
anything else beginning with `on` is refused instead of written, on the server
and in the browser alike, and development says which name it dropped. The
reason is that a spread is the one place where a runtime object chooses the
_names_ in the markup — spread a dictionary you did not write, a database row
or a query string, and without the rule its author chooses what the page runs.
A custom attribute that has to start with those two letters belongs under
`data-`.

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
