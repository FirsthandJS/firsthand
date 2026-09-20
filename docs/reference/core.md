# @firsthandjs/core

[Reference index](../README.md#reference) · 2.42 kB gzip · no dependencies

The reactive graph, the owner tree and context. It imports nothing from the
DOM and loads unchanged in a worker or on a server.

Everything here is re-exported by `@firsthandjs/dom`, so an application usually
imports from there.

---

## signal

```ts
function signal<T>(value: T, options?: CellOptions<T>): Signal<T>;

interface Signal<T> {
  value: T; // read (tracked) and write
  peek(): T; // read without subscribing
  set(update: (previous: T) => T): void;
}

interface CellOptions<T> {
  /** `Object.is` by default. `false` notifies on every write. */
  equals?: ((a: T, b: T) => boolean) | false;
}
```

A write that the comparison considers equal does nothing downstream.

## computed

```ts
function computed<T>(fn: () => T, options?: CellOptions<T>): ReadonlyCell<T>;

interface ReadonlyCell<T> {
  readonly value: T;
  peek(): T;
}
```

Lazy and memoised. A computed nobody reads never runs; one whose value did not
change notifies nothing.

## effect

```ts
function effect(fn: () => void | (() => void)): Dispose;
type Dispose = () => void;
```

Runs immediately, and again when something it read changes. A returned function
cleans up before each re-run and on disposal. Owned by the surrounding scope;
the returned disposer is for when you want to stop it earlier.

## batch / untrack

```ts
function batch<T>(fn: () => T): T;
function untrack<T>(fn: () => T): T;
```

`batch` defers the flush to the end of the outermost call. `untrack` reads
without subscribing.

## snapshot

```ts
function snapshot<T>(read: () => T): T;
```

A read that is meant to happen once. It untracks, exactly as `untrack` does,
and it says why — which is the difference that matters when someone reads the
code a month later, and the difference
[strict reactivity](#setstrictreactivity) looks for.

```ts
const Field = component<{ initial: string }>((props) => {
  // The starting value of something editable. It must *not* follow the prop:
  // that would overwrite what the person is typing.
  const draft = signal(snapshot(() => props.initial));
  return <input value={draft.value} onInput={(e) => (draft.value = e.currentTarget.value)} />;
});
```

## setStrictReactivity

```ts
function setStrictReactivity(on: boolean): void;
```

Development-only. Reports a signal or prop read inside a component setup with
nothing subscribing — a value read once and then kept, which produces a number
that is right at first and never moves again. See
[Setup runs once](../guide/03-components.md#setup-runs-once-so-a-value-you-read-is-a-value-you-keep).

```ts
if (import.meta.env.DEV) {
  setStrictReactivity(true);
}
```

**Off by default**, because reading once is often deliberate — the starting
value of a field, or a decision about what to build. Turning it on unasked
would report those too, and a warning that is usually wrong is a warning people
learn to skip.

It reports **once per read**, not once per instance: a list of a thousand rows
prints one line. It says nothing about a read inside `snapshot()`, `peek()`,
`untrack()`, an `effect`, a `computed`, a part or an event handler — none of
those is a frozen value.

**It costs nothing in production.** The check lives in the module the build
replaces with an empty stub, so a production bundle contains neither the check
nor its message, and the read path keeps the single branch it has today. This
function is still there and still callable; it simply does nothing.

## Lifecycle

```ts
function onCleanup(fn: () => void): void;
function createRoot<T>(fn: (dispose: Dispose) => T): T;
function catchError<T>(fn: () => T, handler: (error: unknown) => void): T | undefined;
function getOwner(): Owner | null;
function runWithOwner<T>(owner: Owner | null, fn: () => T): T;
```

`catchError` catches what `fn` throws and what anything created inside it
throws later. `runWithOwner` re-enters a scope, which is how a callback outside
the render creates something that is still disposed with its component.

## Context

```ts
function createContext<T>(): Context<T>; // reading without a provider throws
function createContext<T>(defaultValue: T, description?: string): Context<T>;

function provide<T>(context: Context<T>, value: NoInfer<T> | ReadonlyCell<NoInfer<T>>): void;
function useContext<T>(context: Context<T>): ReadonlyCell<T>;
```

`provide` affects the current scope and everything created under it afterwards.
`useContext` resolves once, at setup; reading the returned cell afterwards is
one signal read, whatever the depth.

## Errors

```ts
class FirsthandCycleError extends Error {} // an effect that writes what it reads
class FirsthandContextError extends Error {} // no provider, and no default
class FirsthandReadonlyError extends Error {} // writing a readonly cell
```

`FirsthandCycleError` is deliberately not catchable by `catchError`.

## Types

```ts
type Dispose = () => void;
type ReadonlyProps<T>; // deeply readonly view of a props object
type DeepReadonly<T>;
type Owner; // opaque: a scope in the owner tree
```

## Not the public contract

`Cell`, `createOwner`, `disposeOwner`, `disposeCell`, `handleError`, `own`,
`setOwner`, `createEffect` and `bind` are exported for `@firsthandjs/dom` and
documented as internal. They may change without a major version.
