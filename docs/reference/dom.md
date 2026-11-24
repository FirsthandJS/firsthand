# @firsthandjs/dom

[Reference index](../README.md#reference) · 5.37 kB gzip · depends on
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
  attributes?: Readonly<Record<string, AttributeCodec>>;
}

/** Converts an attribute string to a prop value. `null` means "absent". */
type AttributeCodec = (raw: string | null) => unknown;
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
type View =
  Node | string | number | boolean | null | undefined | DynamicChild | readonly View[] | Render;

/** A view evaluated as a whole, again, when something it read changes. */
type Render = () => View;
```

**A setup may return a render function.** It is an ordinary function and
therefore an ordinary reactive scope, one level up from `computed` and
`effect`: statements in it are its dependencies, and markup expressions that
name nothing it made keep scopes of their own.

```tsx
component(() => {
  const draft = signal('');

  return () => {
    if (!draft.value) {
      return <Empty />;
    }
    return <Editor draft={draft} />;
  };
});
```

What it does: a site is built once and written afterwards, so a run that keeps
the same branch keeps the same nodes — and whatever the DOM was holding, such
as focus and a caret. A branch the run stops returning is disposed. Children
written inside it keep their instance, and props fed from the run reach them
through cells, so a prop that did not change wakes nothing.

What it may not do, both build errors: make anything persistent (`signal`,
`computed`, `effect`, `useResource`, …), which belongs in the setup; and repeat
markup without a `key`. See
[Functions are the unit of reactive work](../guide/03-components.md#functions-are-the-unit-of-reactive-work)
and [ADR-0026](../adr/0026-a-function-is-a-reactive-scope.md).

**A plain function that returns markup is a view**, and needs no `component()`:

```tsx
function Badge({ kind }: { kind: string }) {
  return <span class={kind}>{kind}</span>;
}
```

Written as a tag it is a reactive scope with a place of its own; called, it is
a function call and behaves like one. It has no setup, so it may not hold
anything either. `component()` is what says _this view needs a setup_.

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

## What a spread does with a key

The compiler emits a specialised setter wherever it knows the kind of a part,
so these rules are what is left: `class` and `style`, which accept several
shapes, and every key that came from a runtime object.

| key                       | what happens                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `class` / `className`     | string, array or record; a record toggles on truthiness         |
| `style`                   | string or record; a declaration with no value is removed        |
| `ref`                     | called with the node                                            |
| `prop:x`                  | assigned as a property                                          |
| `attr:x`                  | written as the attribute `x`                                    |
| `onClick`, `on:sl-change` | a listener, delegated where possible                            |
| anything else `on…`       | **refused**, and said so in development                         |
| `null` / `undefined`      | the attribute is removed, never written as text                 |
| everything else           | the property where the element has one, otherwise the attribute |

The refusal is a security rule. A spread often carries a dictionary the
application did not write, and `{ onmouseover: 'alert(1)' }` would otherwise
become an inline handler — so a name is a listener only when it is spelled the
way a component spells one, with a capital letter or a colon after the `on`.
A custom attribute that has to start with those two letters belongs under
`data-`.

The server writes exactly the same table, which is what makes hydration a
comparison rather than a correction — see
[@firsthandjs/server](server.md#a-spread).

## @firsthandjs/dom/internal

The compiler/runtime protocol: `template`, `path`, `insert`, `applyChild`,
`reconcile`, `part`, the specialised setters, `spread`, `rest`, `list`,
`createComponent`, `bind`, and `PROTOCOL_VERSION`.

It is importable and documented so that "no benchmark-only runtime" is
checkable, but it is versioned by `PROTOCOL_VERSION` rather than by semver and
may change whenever the compiler does.
