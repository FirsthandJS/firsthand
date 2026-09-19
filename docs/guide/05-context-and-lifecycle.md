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

// Later, outside any scope — in a callback, a promise, an event from elsewhere:
runWithOwner(owner, () => {
  effect(() => …); // owned by that component, disposed with it
});
```

Without `runWithOwner`, an effect created in a `setTimeout` belongs to nothing
and is never disposed. The framework warns about that in development.

---

Next: [Events and forms](06-events-and-forms.md).
