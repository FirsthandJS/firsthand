# Firsthand — API Design

> **Status: the original design document, kept as a record.** It is what the
> API was designed to be before any of it existed, and the reasoning is still
> the reasoning. The authoritative list of what exists today is
> [`docs/reference/`](docs/reference/) — one page per package, every export
> with its signature — and anything not listed there is internal.
>
> What arrived after this document was written, and why, is in the
> [ADRs](docs/adr/): the router and its typed routes (ADR-0013), the tag-based
> cache (ADR-0014), styling (ADR-0015), component-library interop (ADR-0016)
> and element types this framework does not own (ADR-0017).

Design constraint: a developer should be able to hold the entire model in their
head after reading one page. New API is added only when a problem cannot be
solved cleanly with ordinary JavaScript and DOM.

---

## 1. The whole surface

```ts
// reactivity
signal<T>(value: T, options?: { equals?: ((a: T, b: T) => boolean) | false }): Signal<T>
computed<T>(fn: () => T, options?: { equals?: ... }): ReadonlyCell<T>
effect(fn: (() => void) | (() => () => void)): Dispose
batch<T>(fn: () => T): T
untrack<T>(fn: () => T): T

// lifecycle / ownership
onCleanup(fn: () => void): void
createRoot<T>(fn: (dispose: Dispose) => T): T
catchError<T>(fn: () => T, handler: (error: unknown) => void): T

// components
component<P>(setup: (props: ReadonlyProps<P>) => JSX.Element, options?: ComponentOptions): Component<P>
defineElement(component: Component<never>, tag?: string): void
setElementPrefix(prefix: string): void

// context
createContext<T>(defaultValue?: T): Context<T>
provide<T>(context: Context<T>, value: T | ReadonlyCell<T>): void
useContext<T>(context: Context<T>): ReadonlyCell<T>

// DOM
render(view: () => JSX.Element, container: ParentNode): Dispose
portal(view: JSX.Element, target: ParentNode): null
list<T>(each, key, render): () => Node[]   // what a keyed .map() compiles to
mergeProps(...sources): Props              // spread without flattening accessors
runWithOwner(owner, fn): T                 // re-establish a scope after an await
```

That was 19 exports as designed; `@firsthandjs/dom` ships 27 today, the difference
being the error classes, `on`/`off`, and `setComponentAdapter` (ADR-0017).
Several of them — `list`, `mergeProps`, `runWithOwner`, `setComponentAdapter` —
exist for the compiler, for asynchronous code, or for another framework's
components rather than for everyday use. Everything else — memoisation, derived state, "callbacks",
subscriptions — is expressed with these.

### Deliberate non-API

| Not provided      | Because                                                         |
| ----------------- | --------------------------------------------------------------- |
| `useMemo`         | `computed` is already memoised and has no dependency array      |
| `useCallback`     | handlers are created once; there is nothing to stabilise        |
| `memo()`          | nothing re-renders, so there is nothing to skip                 |
| `useRef`          | a plain `let` works; `ref={el => ...}` covers DOM refs          |
| dependency arrays | dependencies are observed, not declared                         |
| `key` as a prop   | `key` is consumed by the list part, never passed to a component |

---

## 2. Reactivity

### `signal`

```ts
const count = signal(0);
count.value; // read (tracked inside effects/computeds)
count.value = 1; // write (synchronously flushes dependents)
count.peek(); // read without subscribing
count.set((v) => v + 1); // functional update, reads untracked
```

`.value` rather than a call pair (`count()` / `setCount()`) because it keeps read
and write on one object, reads naturally in TSX (`{count.value}`), and makes the
"this is a live read" signal visually explicit at every use site. The cost is one
property access through a getter, which engines inline.

Equality: `Object.is` by default. `{ equals: false }` makes every write
propagate (useful for mutable structures the application diffs itself).

### `computed`

Lazy and memoised. A computed that nobody reads is never evaluated. A computed
whose dependencies changed but whose own value did not (`Object.is`) does not
propagate further.

### `effect`

```ts
const dispose = effect(() => {
  el.textContent = name.value;
  return () => {
    /* cleanup, runs before each re-run and on dispose */
  };
});
```

Effects re-run when a dependency changes. Dependencies are re-observed on every
run, so a conditional read genuinely removes the unused dependency:

```ts
effect(() => {
  if (a.value) console.log(b.value);
}); // not subscribed to b when a is falsy
```

An effect created inside another effect or inside a component is owned by it and
disposed with it.

### `batch` / `untrack`

`batch(fn)` defers the flush to the end of the outermost batch.
`untrack(fn)` reads without subscribing. Both are re-entrant.

### Stale closures

```ts
const count = signal(0);
button.onclick = () => console.log(count.value); // always current
```

The handler reads the signal at click time. There is no render snapshot, so
there is no framework-induced stale closure. Ordinary JavaScript capture still
does what JavaScript does:

```ts
const snapshot = count.value; // deliberately frozen number
button.onclick = () => console.log(snapshot); // always the old value
```

The difference is the difference between capturing the _cell_ and capturing the
_value_. Firsthand never captures values on the developer's behalf.

---

## 3. Components

```tsx
type CounterProps = { initial: number };

export const Counter = component((props: ReadonlyProps<CounterProps>) => {
  const count = signal(props.initial); // read once, on purpose
  const doubled = computed(() => count.value * 2);
  const increment = () => count.value++; // stable for the instance's lifetime

  onCleanup(() => console.log('gone'));

  return (
    <button class={count.value > 10 ? 'high' : 'normal'} onClick={increment}>
      {count.value} x 2 = {doubled.value}
    </button>
  );
});
```

Usage: `<Counter initial={10} />`. No name string, ever.

The setup function runs **once per instance**. `console.log` in the body prints
once. Each dynamic expression in the returned TSX becomes its own DOM part.

`ComponentOptions`:

```ts
{
  shadow?: boolean;           // default false (ADR-0007)
  tag?: true | string;        // host this component as a custom element
  attributes?: AttrSchema;    // explicit attribute -> prop codecs for vanilla HTML
}
```

### Lifecycle

| Moment              | API                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| setup               | the function body                                                                                                              |
| after DOM insertion | `effect(() => { ... })` reading a ref, or `onMount` is deliberately absent — an effect already runs after the subtree is built |
| teardown            | `onCleanup(fn)`                                                                                                                |

### `if (cond) { const local = signal(1) }`

Legal. Reactive primitives are plain objects with their own identity; nothing is
indexed by call order. The signal's lifecycle is the owner it was created in.

---

## 4. Props

Props are real JavaScript values: objects, arrays, functions, class instances,
`Map`s. They are passed by reference and never serialised or copied.

```tsx
<UserCard user={user} items={items} config={config} onSave={save} />
```

`props.user === user` is guaranteed.

Dynamic props (`user={currentUser.value}`) compile to getters, so reading
`props.user` inside an effect or a DOM part subscribes to whatever the parent
expression reads. The child is not re-initialised when the prop changes.

```tsx
const UserCard = component((props: ReadonlyProps<{ user: User }>) => (
  <span>{props.user.name}</span> // updates when currentUser changes
));
```

### Destructuring

```tsx
component<Props>(({ user, count = 0, ...rest }) => ...)
// becomes
component<Props>((props) => { const rest = ...; ... props.user ... props.count ?? 0 ... })
```

The compiler rewrites a destructured props parameter into property reads, so
every use stays live. Defaults are re-applied on each read; a rest element
becomes an object of getters that delegate back to the props, so forwarding
`{...rest}` forwards live values.

Patterns that cannot be rewritten soundly are a build error naming the reason:
assigning to a destructured prop, a computed key, or an array pattern.

### Types

```ts
type ReadonlyProps<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
```

Runtime enforcement is limited to "no setters on the props object" — see
ARCHITECTURE section 3.3 for why nothing stronger is possible without paying in
identity, copies or proxies.

---

## 5. Context

```tsx
type Theme = { mode: 'light' | 'dark' };
const ThemeContext = createContext<Theme>();

const App = component(() => {
  const theme = signal<Theme>({ mode: 'dark' });
  provide(ThemeContext, theme);
  return <Page />;
});

const Button = component(() => {
  const theme = useContext(ThemeContext);
  return <button>{theme.value.mode}</button>;
});
```

`provide` accepts a plain value (wrapped in a cell) or an existing cell.
`useContext` returns a `ReadonlyCell<T>`; consumers subscribe to the cell, not
to a traversal. Works identically through portals and shadow roots.

---

## 6. Portals

```tsx
{
  isOpen.value && portal(<Modal onClose={close} />, document.body);
}
```

The portal keeps its logical owner: context, disposal, reactive dependencies,
event handling and error ownership all continue to come from where the portal
was written, not from where its DOM landed.

---

## 7. TSX

Ordinary JavaScript expressions are supported in every position:

```tsx
<div>{count.value}</div>
<div class={active.value ? 'active' : 'inactive'} />
{loggedIn.value ? <Dashboard /> : <Login />}
<div>{firstName.value + ' ' + lastName.value}</div>
<button disabled={!permissions.value.canEdit}>Edit</button>
<div style={{ opacity: visible.value ? 1 : 0 }} />
{items.value.map(item => <Row key={item.id} item={item} />)}
```

Each such expression becomes exactly one DOM part. A change re-evaluates that
expression and nothing else; the component function does not run again.

Attribute conventions:

- `class` and `className` both work; `class` is canonical.
- `style` accepts a string or an object (per-property diff, no `cssText`
  rewrite).
- `onX` is an event handler. `onX:native`, `onX:capture`, `onX:once`,
  `onX:passive` are the escape hatches.
- `prop:x` forces a DOM property, `attr:x` forces an attribute. Without a
  prefix, the compiler picks based on a static table of known element
  properties.
- `ref={el => ...}` receives the element after creation.

---

## 8. Custom elements

```ts
setElementPrefix('acme'); // once per package
defineElement(UserCard); // registers <acme-user-card>
```

The tag name is derived from the compiler-assigned stable id plus the original
identifier (`UserCard` -> `acme-user-card`), so it survives minification. Inside
TSX you keep using the symbol. For vanilla HTML consumers, attributes map to
props through an explicit codec schema:

```ts
component(fn, { tag: true, attributes: { count: Number, label: String } });
```

Within TypeScript/TSX, JS properties remain the primary mechanism; attributes
are an interop feature, not the model.

---

## 9. Error boundaries

```tsx
catchError(
  () => <RiskyTree />,
  (err) => {
    logger.report(err);
  },
);
```

Ownership follows the owner tree, so a portal's errors reach the boundary that
lexically encloses the portal call.
