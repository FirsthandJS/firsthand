# Context and lifecycle

[Index](../README.md) · Previous: [Rendering](04-rendering.md) · Next:
[Events and forms](06-events-and-forms.md)

---

## Context

```tsx
import { createContext, provide, useContext } from '@firsthandjs/dom';

interface Theme {
  readonly mode: 'light' | 'dark';
}

const ThemeContext = createContext<Theme>();

const App = component(() => {
  const theme = signal<Theme>({ mode: 'light' });
  provide(ThemeContext, theme); // a cell: it can change
  return <Shell />;
});

const Button = component(() => {
  const theme = useContext(ThemeContext); // resolved once, at setup
  return <button class={theme.value.mode}>Save</button>; // a fine-grained read
});
```

**`provide` before creating the children that should see it.** It affects the
current scope and everything created under it afterwards.

**`useContext` resolves once**, at setup, and returns the provider's cell.
After that, `theme.value` costs one signal read — no tree walk, no map lookup,
no DOM traversal, however deep the component is
([ADR-0008](../adr/0008-owner-tree-for-context-and-portals.md)).

Provide a plain value when it never changes:

```tsx
provide(ThemeContext, { mode: 'dark' }); // constant
provide(ThemeContext, themeSignal); // swappable
```

### A provider anywhere, not only at the root

A wrapper component provides for its children:

```tsx
const Themed = component((props: { children?: View }) => {
  provide(ThemeContext, { mode: 'dark' });
  return <div class="themed">{props.children}</div>;
});

<Themed>
  <Button /> {/* reads `dark` */}
</Themed>;
```

That works at any depth, through a fragment, through several nested providers
(the nearest wins), and for a child handed down as a prop from further up.

The one thing to know is _when_ a child is built, because that is what decides
where it reads from. Markup is built where it is written, so a local variable
already holds a built child:

```tsx
const child = <Button />; // built here, reads context from here
return <Themed>{child}</Themed>; // too late: it already has a scope
```

Hold a function instead, and it is built where it is used:

```tsx
const child = () => <Button />;
return <Themed>{child}</Themed>; // reads `dark`
```

Holding the _component_ rather than its markup does the same thing, since
`<Held />` is an instantiation rather than a value:

```tsx
const Held = Button;
return (
  <Themed>
    <Held />
  </Themed>
); // reads `dark`
```

No context system can repair the first version: by the time the provider runs,
the child already exists and already has a scope. Development says so rather
than leaving you with a default — a read that falls back while the same token is
provided somewhere else warns, and names this as the likely cause.

### No provider

A context created without a default **throws** when read with no provider,
naming itself:

```tsx
const ThemeContext = createContext<Theme>(); // no default
useContext(ThemeContext); // FirsthandContextError: context
```

That is usually what you want: a missing provider is a bug, not a state. Give a
default when there is a sensible one:

```tsx
const ThemeContext = createContext<Theme>({ mode: 'light' }, 'theme');
```

### Context and portals

A portal keeps the context of where it was **written**, not where its DOM
ended up. A modal rendered into `document.body` still sees the theme of the
component that opened it.

## Cleanup

```tsx
import { onCleanup } from '@firsthandjs/dom';

const Clock = component(() => {
  const now = signal(Date.now());
  const id = setInterval(() => (now.value = Date.now()), 1000);
  onCleanup(() => clearInterval(id));

  return <time>{new Date(now.value).toLocaleTimeString()}</time>;
});
```

`onCleanup` registers with the current scope — a component, an effect, or a
root. It runs when that scope is disposed: the component is removed, the
conditional branch it was in flipped, the list row was deleted, or the root was
stopped.

An effect's own cleanup is its return value, and it runs before each re-run as
well as on disposal:

```tsx
effect(() => {
  const socket = new WebSocket(url.value);
  return () => socket.close();
});
```

## Roots

Outside a component — a test, a worker, a non-UI use of the reactive core —
create a scope yourself:

```ts
import { createRoot } from '@firsthandjs/core';

const stop = createRoot((dispose) => {
  effect(() => console.log(count.value));
  return dispose;
});

stop();
```

`render()` creates one for you; its returned disposer is that root's.

## Error boundaries

```tsx
import { catchError } from '@firsthandjs/dom';

const Safe = component(() => {
  const failure = signal<unknown>(null);

  return catchError(
    () => <RiskyThing />,
    (error) => (failure.value = error),
  );
});
```

`catchError` catches what the function throws, and what anything created inside
it throws later — a component's setup, an effect's body, a part's expression.
The handler runs with the owner restored, so it can set state safely.

Errors propagate up the owner tree until something handles them; unhandled,
they reach the console the way an unhandled error does.

`FirsthandCycleError` is deliberately **not** catchable by a boundary: a cyclic
effect is a bug in the code, not a condition to recover from.

## The owner tree

Everything above is one mechanism. Every component, effect and root is an
_owner_; owners nest; and an owner holds three things:

- the cleanups registered under it,
- the context values provided in it,
- the error handler installed in it.

Disposing an owner disposes its children, depth first. This tree is
**independent of the DOM**, which is why a portal behaves like its lexical
position and why a keyed row survives being moved.

You rarely touch it directly, but two functions expose it when you need them:

```ts
import { getOwner, runWithOwner } from '@firsthandjs/core';

const owner = getOwner();

// Later, outside any scope — in a callback, an event from elsewhere:
runWithOwner(owner, () => {
  effect(() => …); // owned by that component, disposed with it
});
```

Without `runWithOwner`, an effect created in a `setTimeout` belongs to nothing
and is never disposed. The framework warns about that in development.

`runWithOwner` is a **synchronous** bracket. It establishes the owner, runs the
function and puts the owner back, so it does not survive an `await` — after the
first suspension of an async function there is no owner again. That is what the
next section is for.

## Async work

An `await` resumes with no owner. Nothing above reaches past it, so an
asynchronous continuation can outlive the component it started in and still
write to it:

```ts
onClick={async () => {
  const saved = await save(draft.value);
  status.value = saved; // the component may be long gone
}}
```

That write is the quietest bug the framework can produce: the component is
disposed, its subscribers are already unlinked, so the value changes, nothing
updates, and nothing is reported.

`task` is the fix. It owns an `AbortController`, hangs a scope off the current
owner, and asks that owner to abort it on disposal:

```ts
import { task } from '@firsthandjs/core';

task(async ({ signal, resume }) => {
  const saved = await resume(save(draft.value, { signal }));
  status.value = saved; // reached only while this is still the current run
});
```

`resume` is what makes it work. It awaits the value and then checks whether this
run is still the one anybody wants; if the task has been aborted in the
meantime, it throws and the rest of the body never runs. The task swallows that
— being superseded is the machinery working, not an error to handle.

### Supersession is free

Put a task inside an effect and you get "the newest run wins" without writing
any bookkeeping, because disposing the previous run is something the owner tree
already does:

```ts
effect(() => {
  const id = userId.value;
  task(async ({ signal, resume }) => {
    profile.value = await resume(fetchUser(id, { signal }));
  });
});
```

When `userId` changes the effect runs again, which disposes what the last run
made, which aborts that task, which makes its next `resume` throw. A slow first
request can no longer answer last and overwrite a newer value.

### Context and cleanup after an await

There is no ambient owner after a suspension, so anything that needs to know
what it belongs to goes through `run`:

```ts
task(async ({ resume, run }) => {
  await resume(tick());
  run(() => {
    const theme = useContext(Theme).value;
    onCleanup(() => release());
  });
});
```

A task's scope ends when its work ends, so what `run` creates is disposed when
the task finishes. Anything that has to outlive it belongs to the owner above.

The handle it returns carries the result and a way to stop it by hand:

```ts
const job = task(async ({ resume }) => resume(work()));

job.abort(); // the next resume throws, the scope is disposed
await job.promise; // never rejects: undefined if it was superseded or threw
```

An error that is _not_ supersession goes to the nearest error boundary above the
task, exactly where an error from an effect would have gone.

Resources and actions in [`@firsthandjs/data`](09-data.md) follow the same
ownership rule, so most applications get this without calling `task` directly.
Reach for it when you are writing async work by hand.

---

Next: [Events and forms](06-events-and-forms.md).
