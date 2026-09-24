# Server rendering and hydration

[Index](../README.md) · Previous: [Building and deploying](16-building.md)

---

A page that arrives empty and fills itself in is slower to read, worse to index
and worse to share. Server rendering sends the content with the page;
hydration is what stops the browser from throwing it away and building it
again.

Both are the same application. Nothing in this chapter asks you to write a
component differently.

```bash
npm install @firsthandjs/server
```

## The shortest version

Three things change, and nothing else does.

**A server renders to a string:**

```tsx
import { renderToString } from '@firsthandjs/server';

const html = renderToString(() => <App />);
```

**A browser adopts instead of building:**

```tsx
import { hydrate } from '@firsthandjs/dom/hydrate';

hydrate(() => <App />, document.getElementById('app')!);
```

**The build says it can hydrate:**

```ts
// vite.config.ts
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ hydratable: true })],
});
```

`hydratable` is the only thing the project declares. Which of the two builds is
running is something Vite already knows, and the plugin asks it: the server
build compiles against `@firsthandjs/server/internal`, the browser build
against `@firsthandjs/dom/internal`, from the same source file.

A complete project is in [`examples/ssr`](../../examples/ssr/) — an
application, two entry points, and a server in eighty lines of `node:http`.

## What is actually different

The same components, the same signals, the same context, the same compiler.
What a server does not have is time and a document, so:

|               | Browser                | Server                                      |
| ------------- | ---------------------- | ------------------------------------------- |
| `setup`       | runs once per instance | runs once per instance                      |
| markup        | a cloned `<template>`  | a string                                    |
| parts         | subscribe and update   | written once                                |
| `effect`      | runs                   | **does not run**                            |
| `onCleanup`   | runs on disposal       | runs when the render is disposed            |
| `ref`         | gets the node          | **not emitted**                             |
| `onClick`     | attached               | **not emitted**, attached by `hydrate`      |
| `useResource` | runs inside an effect  | runs once, awaited by `renderToStringAsync` |

An effect is a side effect over time, and a render that produces one string has
none: there is no later for a second run to happen in, no DOM to touch and
nobody to click. Anything that has to happen _before_ the markup exists is
data, and data has `useResource`.

## Rendering with data

A view that loads something needs the loading to finish before the markup is
worth sending. `renderToStringAsync` renders, waits, and renders again:

```tsx
import { renderToStringAsync } from '@firsthandjs/server';
import { createData, createMemoryStorage, serialize } from '@firsthandjs/data';

export async function render() {
  const storage = createMemoryStorage();
  const data = createData({ storage });

  const html = await renderToStringAsync(() => <App data={data} />, {
    settle: () => data.settle(),
    // A loader that never answers must not hold the response open.
    timeout: 2_000,
  });

  return { html, state: serialize(storage.dump()) };
}
```

`settle` is what waiting means, and the application says so: the server package
knows nothing about the data layer, and an application using a different one
passes its own.

### Giving the browser the answers

A resource belongs to its call site, so it has no key to be serialised under —
that is [ADR-0022](../adr/0022-resources-not-a-cache.md), and it is on purpose.
A **named** resource does have one:

```tsx
const notes = useResource(({ signal }) => listNotes(signal), { persist: 'notes' });
```

`persist` is a name you chose. The server fills a storage under it; the page
carries it; the browser starts from it:

```html
<script>
  window.__FIRSTHAND_DATA__ = { "notes": [...] };
</script>
```

```tsx
const data = createData({ storage: createMemoryStorage(window.__FIRSTHAND_DATA__ ?? {}) });
hydrate(() => <App data={data} />, root);
```

The value is there **during** the resource's first run in the browser, not a
microtask later, which is what makes the first paint the markup rather than a
spinner replacing it.

A resource without a name still renders on the server — the markup has its
content. What it does not do is arrive answered, so the browser loads it again.
That is a decision you make in one word and can see at the call site.

`serialize` is `JSON.stringify` with the characters that would end a `<script>`
element escaped. Use it, or your data ends your script tag.

## What hydration does

`hydrate` runs exactly the same compiled code as `render`. What changes is
where the nodes come from: a template hands back a node the server sent rather
than a clone, and a dynamic child finds its content in place rather than
creating it.

You will see comments in the markup:

<!-- prettier-ignore -->
```html
<p>Hello, <!--[-->Ada<!---->!</p>
```

`<!--[-->` says where a dynamic child begins — its content has a length the
template does not, so the markup has to say. The browser removes every one of
them once it has adopted the tree. A child that is the whole of its element's
content gets no marker at all, because where the element's children start is
where the region starts:

```html
<td class="col-md-1">1</td>
```

The markers are in the server's markup only. An application built without
`hydratable` emits neither them nor the navigation that steps over them, and
pays nothing for either.

### When the two sides disagree

The view has to be the view the server rendered — same props, same state, same
answer. Where it is not:

- A **dynamic** value that disagrees is written, as it would be on any other
  change. The page ends up right; the work hydration saved is spent.
- A **different element** is not adopted. The browser builds its own and the
  part it belongs to puts it in place of what was sent.
- **Static markup** that disagrees is kept as the server wrote it, because
  static markup is the markup nothing ever writes again. Development says so by
  name:

  ```
  [firsthand] Hydration found <div class="wide"> where this render describes
  "narrow". The markup is kept as the server sent it, because static markup is
  never written again.
  ```

A view that renders two different things from the same props is a bug no
framework can repair. The usual causes are `Date.now()`, `Math.random()` and
reading `window` in a setup.

A spread is the one place where the framework itself could disagree, because
its names and shapes come from a runtime object rather than from the compiler.
It is written to mean the same thing on both sides — a class record toggles on
truthiness, a style record is serialized, `prop:`/`attr:` do what they say, and
a key spelled `onmouseover` is refused rather than written. The two tables are
in the [DOM](../reference/dom.md#what-a-spread-does-with-a-key) and
[server](../reference/server.md#a-spread) references, and asserted against each
other in `spread-parity.test.ts`.

### One thing that is rebuilt

Markup assigned to a local variable is built rather than adopted:

```tsx
return () => {
  const badge = <span>{label}</span>; // built by the browser, not adopted
  return <div>{badge}</div>;
};
```

Locals are evaluated before the element they go into, and markup is adopted
outside-in — so by the time the `div` is adopted, the `span` has already been
made. The page is correct and one element is rebuilt. Writing the markup where
it is used, which is how JSX is usually written, adopts it like everything
else.

## Custom elements

A component with a `tag` is written as that element, with its content inside:

```tsx
const Card = component(() => <div class="card">…</div>, { tag: 'my-card' });
```

```html
<my-card><div class="card">…</div></my-card>
```

A `shadow: true` component is written as a declarative shadow root, which is
the only way markup can express one. The browser's own `defineElement` then
takes it over.

## Performance

Measured against the frameworks that render the same way, with the same rules
the browser benchmark keeps — the output compared before anything is timed, the
frameworks interleaved in one process, production builds on every side:

| 1 000 rows       | Firsthand    | Solid     | Vue       | React     |
| ---------------- | ------------ | --------- | --------- | --------- |
| render to markup | **0.171 ms** | 0.205 ms  | 15.02 ms  | 199.67 ms |
| markup size      | 222 802 B    | 238 694 B | 222 802 B | 222 802 B |
| hydrate          | **4.12 ms**  | 4.62 ms   | 10.48 ms  | —         |

Reproduce them with:

```bash
node benchmarks/ssr/run.mjs
node benchmarks/ssr/hydrate.mjs
```

React's `hydrateRoot` schedules its work rather than doing it, so a number
taken the same way would be the time to _start_ hydrating. It is left out
rather than reported as something it is not.

### What it costs an application without a server

Nothing. Hydration is its own entry point and nothing in the render path
imports it, so a bundle that never mentions `@firsthandjs/dom/hydrate` does not
contain it. The runtime budget is the same 7.00 kB gzip it was before server
rendering existed.

## Checklist

- `firsthand({ hydratable: true })` in the Vite config.
- One storage, one data store, **per request**. Nothing shared between two
  visitors.
- `renderToStringAsync` with a `settle` and a `timeout` if anything loads.
- `serialize` whatever goes into a `<script>`.
- `hydrate`, not `render`, in the browser entry point.
- Nothing in a setup that differs between the two sides.

---

[Index](../README.md) · Previous: [Building and deploying](16-building.md)
