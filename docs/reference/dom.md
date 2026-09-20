# @firsthandjs/dom

[Reference index](../README.md#reference) · 4.30 kB gzip · depends on
`@firsthandjs/core`

Components, rendering, and the DOM parts the compiler emits. Re-exports
everything from `@firsthandjs/core`, so this is the only runtime import most
applications need.

---

## component

```ts
function component<P>(
  setup: (props: ReadonlyProps<P>) => View,
  options?: ComponentOptions,
  id?: string,
  name?: string,
): Component<P>;

interface ComponentOptions {
  /** Host in a real custom element. */
  tag?: true | string;
  /** Attach a shadow root. Implies `tag`. */
  shadow?: boolean;
  /** Attribute codecs, for consumers writing plain HTML. */
  attributes?: Readonly<Record<string, (raw: string | null) => unknown>>;
}
```

`id` and `name` are filled in by the compiler; do not write them by hand.

A `Component<P>` is callable: `Counter({ initial: 1 })` is what
`<Counter initial={1} />` compiles to.

**`setup` runs exactly once per instance.** It is not re-run when a prop or a
signal changes — the parts it returned are. A value read in its body is
therefore read once and kept: `const id = props.id` is a snapshot, while
`props.id` inside a part, a handler, an `effect` or a `computed` is a live read.
See [Setup runs once](../guide/03-components.md#setup-runs-once-so-a-value-you-read-is-a-value-you-keep).

```ts
type View = Node | string | number | boolean | null | undefined | DynamicChild | readonly View[];
```

## render

```ts
function render(view: () => View, container?: ParentNode): Dispose;
```

Mounts into `document.body` by default. The disposer unsubscribes every effect,
runs every cleanup and removes exactly the nodes it inserted.

## createComponent

```ts
function createComponent<P>(target: Component<P>, props: P): View;
```

What the compiler emits for `<Component />`. Props are frozen and passed by
reference; nothing is copied.

## Custom elements

```ts
function setElementPrefix(prefix: string): void;
function defineElement(target: Component<never>, tag?: string): string;
```

`setElementPrefix` once at startup; `defineElement` is idempotent and returns
the registered name.

## Foreign element types

```ts
function setComponentAdapter(adapter: ComponentAdapter | null): void;
type ComponentAdapter = (target: (props: never) => unknown) => Component<never>;
class FirsthandComponentError extends Error {}
```

An element type that is not a Firsthand component — a React component, say — is
handed to the installed adapter, once per component type, and the result is
cached. With no adapter installed, creating one throws `FirsthandComponentError`,
which names the fix.

Nothing here knows what React is; `@firsthandjs/react/auto` is what installs an
adapter, and any other framework can be taught the same way.

## portal

```ts
function portal(view: () => View, target?: ParentNode): View;
```

Renders into another part of the document while keeping this component's
context, disposal and error boundary.

## list

```ts
function list<T>(
  items: () => readonly T[],
  key: (item: T, index: number) => unknown,
  render: (item: ReadonlyCell<T>, index: ReadonlyCell<number>) => View,
): () => View;
```

What a keyed `.map()` compiles to. Write the `.map()`; this is here because the
protocol is documented, not because you should call it.

## Events

```ts
function on(
  node: Element,
  type: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions | true,
): void;
function off(node: Element, type: string): void;
```

Delegated where possible; `true` forces a direct listener.

## mergeProps

```ts
function mergeProps(...sources: Record<string, unknown>[]): Record<string, unknown>;
```

Merges without flattening: every key becomes a getter delegating to its source,
so a reactive prop stays reactive through a spread.

## @firsthandjs/dom/internal

The compiler/runtime protocol: `template`, `path`, `insert`, `applyChild`,
`reconcile`, `part`, the specialised setters, `spread`, `rest`, `list`,
`createComponent`, `bind`, and `PROTOCOL_VERSION`.

It is importable and documented so that "no benchmark-only runtime" is
checkable, but it is versioned by `PROTOCOL_VERSION` rather than by semver and
may change whenever the compiler does.
