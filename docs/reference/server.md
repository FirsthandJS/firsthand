# @firsthandjs/server

[Reference index](../README.md#reference) · 1.26 kB gzip · depends on
`@firsthandjs/core`

Rendering a Firsthand application to markup. The same components, the same
signals, the same context — compiled to build a string instead of a tree.

Runs on a server, so its size is not part of the browser runtime budget. It
never imports `@firsthandjs/dom` and never touches a `document`.

See [the guide](../guide/17-server-rendering.md) and
[ADR-0027](../adr/0027-server-rendering-and-hydration.md).

---

## renderToString

```ts
function renderToString(view: () => unknown, options?: RenderOptions): string;

type RenderOptions = {
  /** Wraps the markup, so the document a server sends is written in one place. */
  document?: (body: string) => string;
};
```

```ts
const html = renderToString(() => <App />);
```

Everything the view creates belongs to a root that is disposed before this
returns, so a server rendering a thousand requests holds nothing from any of
them.

Effects do not run, and refs and event handlers are not emitted — there is no
node to hand to a ref and nobody to click. Both are attached by `hydrate` in
the browser.

## renderToStringAsync

```ts
function renderToStringAsync(view: () => unknown, options?: AsyncRenderOptions): Promise<string>;

type AsyncRenderOptions = RenderOptions & {
  /** Waits for whatever the render started. */
  settle?: () => Promise<void>;
  /** How many times to render before giving up on stillness. Default 5. */
  passes?: number;
  /** How long to wait, in ms, before rendering with what is there. */
  timeout?: number;
};
```

```ts
const html = await renderToStringAsync(() => <App />, {
  settle: () => data.settle(),
  timeout: 2_000,
});
```

Renders, awaits `settle`, and renders again over the same owner — stopping
early when two passes produce the same markup. Without `settle` it is
`renderToString` with a promise around it.

`timeout` matters on a real server: a loader that never answers would
otherwise hold the response open for as long as the client is willing to wait,
which is a page that never arrives rather than one that arrives incomplete.

## Markup

```ts
class Markup {
  constructor(readonly html: string);
}
```

What the compiler's server output is made of. A view is a **string** on a
server, and once markup and text are both strings nothing can tell them apart
— a component returning `<b>hi</b>` would be escaped into visible angle
brackets while a user string containing `<script>` would not be. So markup is
carried in a one-field object and text is not.

Return one from a component to inject markup you have already escaped
yourself. Nothing else does.

## escapeText · escapeAttribute

```ts
function escapeText(value: string): string;
function escapeAttribute(value: string): string;
```

`&`, `<` and `>` for a child position; `&` and `"` for a double-quoted
attribute. Exported because a caller building markup by hand needs the same
guarantees the compiler's output has.

---

## What a server render does differently

|               | Browser               | Server                              |
| ------------- | --------------------- | ----------------------------------- |
| `effect`      | runs                  | does not run                        |
| `ref`         | gets the node         | not emitted                         |
| `onClick`     | attached              | not emitted                         |
| `useResource` | runs inside an effect | runs once, awaited by `settle`      |
| props         | accessors, read live  | read once; pure expressions eagerly |
| scopes        | one per component     | made only when something asks       |

The last two are performance decisions with a visible edge, and both are in
[ADR-0027](../adr/0027-server-rendering-and-hydration.md):

- A prop whose expression is a name, a member chain, a literal or an operator
  over them is written into the props object as a **value**. On a server a prop
  is read once and nothing can change under it, so nobody could notice. A call,
  an assignment or an `await` keeps its accessor, because evaluating _those_
  early could be seen.
- A component's scope is described rather than created. The first `provide`,
  `signal`, `onCleanup` or `catchError` makes one, with the right parent; a
  component that only reads its props and returns markup never needs one.

### A spread

`{...props}` is the one place where the attribute _names_ and the _shapes_ come
from a runtime object rather than from the compiler, so it is written to mean
exactly what `applyProp` means in a browser:

| spread key                | server                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `class` / `className`     | string, array or record; a record toggles on truthiness, as `classList` does                     |
| `style`                   | string or record; a record is serialized, hyphenated, and declarations with no value are dropped |
| `prop:x`                  | the attribute a parser seeds for that property, or nothing                                       |
| `attr:x`                  | the attribute `x`                                                                                |
| `onClick`, `on:sl-change` | nothing; a listener is not markup                                                                |
| anything else `on…`       | **refused**, with a warning                                                                      |
| everything else           | the attribute, if the key is a name a browser accepts                                            |

The last two are a security rule, not a style one. A spread often carries a
dictionary the application did not write — a database row, a query string, a
JSON body — and a key such as `onmouseover`, or one containing a space, would
otherwise put script into the page. A custom attribute that has to start with
those two letters belongs under `data-`.

## @firsthandjs/server/internal

The compiler/runtime protocol for a server render — the twin of
`@firsthandjs/dom/internal`. The compiler emits calls against exactly this
surface when it is asked for server output. It is importable by hand, which is
what makes "no benchmark-only runtime" enforceable rather than promised.

Two surfaces, one set of semantics — a promise kept by measurement rather than
by care: `packages/server/test/parity.test.ts` renders every shape the compiler
can emit both ways and compares the trees.

What that test cannot reach is a spread, because a spread's shapes are not
emitted by the compiler — they arrive at runtime. That is where the two sides
had drifted apart, and `spread-parity.test.ts`, in `packages/server/test` and
`packages/dom/test`, is the same table asserted against both.
