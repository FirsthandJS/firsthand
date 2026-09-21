# Getting started

[Documentation index](../README.md) · Next: [Reactivity](02-reactivity.md)

---

## From nothing, in one minute

Vite is **one** way to get there, not a requirement — the framework has no
opinion about your bundler, and [Without Vite](#without-vite) below sets the
same thing up by hand. It is used here because it is the shortest path to a
running page.

```bash
npm create vite@latest my-app -- --template vanilla-ts
cd my-app
npm install @firsthandjs/dom
npm install --save-dev @firsthandjs/compiler
```

Three edits to what the template produced:

```ts
// vite.config.ts  — create this file
import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'my-app' })],
});
```

```jsonc
// tsconfig.json — add these two, inside "compilerOptions"
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@firsthandjs/jsx-runtime",
  },
}
```

```tsx
// src/main.tsx — rename main.ts to main.tsx, and replace its contents
import { component, render, signal } from '@firsthandjs/dom';

const Counter = component(() => {
  const count = signal(0);
  return <button onClick={() => count.value++}>Clicked {count.value} times</button>;
});

render(() => <Counter />, document.querySelector('#app') as ParentNode);
```

One more line, in `index.html`, because the entry file changed name:

```html
<script type="module" src="/src/main.tsx"></script>
```

`npm run dev`, and the button counts.

## What the pieces are

```bash
npm install @firsthandjs/dom
npm install --save-dev @firsthandjs/compiler
```

`@firsthandjs/dom` re-exports the reactive core, so it is the only runtime import
most applications need. The compiler is build-time only and never reaches the
browser.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'my-app' })],
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@firsthandjs/jsx-runtime"
  }
}
```

`packageName` is used to derive stable component ids and custom element names.
Any string does; it should be stable across builds.

### The check that is already on

The setup function runs **once per instance**, which is the whole model — and
the one mistake it invites is a value read out of the graph and kept:

```tsx
const App = component(() => {
  const v = signal(1);
  const x = v.value; // read once, here, and then kept
  return <p>{x}</p>; // so this number never moves
});
```

Nothing throws at runtime; the number is simply old. With `strictReactivity`
the build refuses it and points at the line:

```
App: `x` is read once, here, and then kept. A setup runs one time per instance,
so this value will not change again.

Move the read into the part, handler, effect or computed that should re-read it
— or wrap it in snapshot(() => …) if reading once is what you meant.
```

You do not have to switch this on; it is on. The rule is narrow enough to
afford that: it only sees a declaration whose initialiser is _nothing but_ a
read, so `signal(props.initial)` — a starting value, not a bug — and everything
else containing a call is left alone. `firsthand({ strictReactivity: false })`
turns it off if your codebase has such a read on purpose.

[Setup runs once](03-components.md#setup-runs-once-so-a-value-you-read-is-a-value-you-keep)
has the whole story. `setStrictReactivity(true)` in your entry module adds the
same report at runtime, for the cases a compiler cannot follow — that one stays
opt-in, because it cannot tell a deliberate read from an accidental one.

## Why JSX has to be configured at all

JSX is not part of TypeScript's default behaviour, and it has no single
meaning: `<div>` is whatever the configured runtime says it is. Two settings
decide that, and they do different jobs.

**`jsxImportSource: "@firsthandjs/jsx-runtime"`** says which JSX this is. It is
what makes `<div class="row">` and `<Counter initial={1} />` type-check — the
package declares `JSX.Element`, `JSX.IntrinsicElements` and the event and
attribute typings. Without it, TypeScript assumes React's JSX and reports that
`class` should be `className`.

**`jsx`** decides who compiles it:

| Setting       | Who transforms the JSX        | When to use it                                     |
| ------------- | ----------------------------- | -------------------------------------------------- |
| `"preserve"`  | The Firsthand compiler plugin | Whenever you use the plugin — the recommended path |
| `"react-jsx"` | TypeScript itself             | When `tsc` is your only build step                 |

With `preserve`, TypeScript leaves the JSX alone and the plugin compiles it
into a hoisted `<template>` plus fine-grained parts. That is the whole point of
having a compiler, so it is the setting the guide uses.

### Why the other one is called `react-jsx`

Because TypeScript named it after the tool it first supported, and the name
stuck. `react-jsx` is TypeScript's label for the **automatic JSX runtime**: it
emits `import { jsx } from "<jsxImportSource>/jsx-runtime"` and calls it. With
`jsxImportSource` pointing at `@firsthandjs/jsx-runtime`, the import goes to
this framework and **no React is involved** — the same setting is what Solid,
Preact and Vue use for their own runtimes.

It is worth knowing about because it is the answer when TypeScript is doing the
emitting on its own. What you get then is the runtime JSX path: correct,
slightly larger and slower, because nothing hoisted the static markup into a
template. The compiler is what buys that back.

## Without Vite

Nothing above is Vite-specific. The compiler is an ordinary Babel plugin, so
anything that can run one can run it:

```js
// babel.config.js
export default {
  plugins: [['@firsthandjs/compiler', { packageName: 'my-app' }]],
};
```

And if you would rather not add a build step at all, leave the compiler out:
set `"jsx": "react-jsx"` and let TypeScript emit the calls. Everything works —
components, signals, the router, resources — through the runtime JSX
path described above. You can add the compiler later without changing a line
of application code; it compiles the same JSX into something faster.

## Your first component

```tsx
import { component, render, signal } from '@firsthandjs/dom';

const Counter = component<{ initial: number }>(({ initial }) => {
  console.log('setup'); // prints once, ever

  const count = signal(initial);

  return <button onClick={() => count.value++}>Clicked {count.value} times</button>;
});

render(() => <Counter initial={0} />);
```

Click the button ten times and `setup` is printed once. The component function
built the DOM and wired up one subscription; clicking writes a signal, and the
one text node that read it is rewritten. Nothing is compared, nothing is
rebuilt.

That single fact is the whole model. Everything else in this guide is a
consequence of it.

## What that means in practice

**There is no dependency array**, because nothing re-runs. An effect observes
what it reads, every time it runs:

```tsx
effect(() => {
  console.log(count.value); // subscribed to count, and to nothing else
});
```

**There are no stale closures.** A handler created in setup reads the current
value, because it reads the signal rather than a captured copy:

```tsx
const handler = () => console.log(count.value); // always current
```

**There is no `useMemo`.** A `computed` is lazy and memoised, and a component
body that runs once has nothing to memoise anyway.

**Order does not matter.** There are no hook slots, so a signal created inside
an `if` is fine.

**And the flip side**: because the body runs once, a value you read in it is a
value you keep. `const count = props.items.length` is a number from the moment
you read it, and it will not move again. Nothing throws — the number is simply
old. [Components](03-components.md#setup-runs-once-so-a-value-you-read-is-a-value-you-keep)
covers what that looks like and where to put the read instead.

## Where to render

```tsx
render(() => <App />); // into document.body
render(() => <App />, container); // into an element you already have
```

`render` returns a disposer:

```tsx
const stop = render(() => <App />);
stop(); // every effect unsubscribed, every cleanup run, every node removed
```

## The packages

You will meet these as you need them; none is required to start.

| Package                 | When you need it                                |
| ----------------------- | ----------------------------------------------- |
| `@firsthandjs/dom`      | Always. Components, rendering, signals          |
| `@firsthandjs/compiler` | Always, as a dev dependency                     |
| `@firsthandjs/router`   | More than one page                              |
| `@firsthandjs/data`     | Talking to a server                             |
| `@firsthandjs/styled`   | Styles written next to the component            |
| `@firsthandjs/react`    | A component library that only exists for React  |
| `@firsthandjs/deep`     | State shaped like a tree, not like a value      |
| `@firsthandjs/i18n`     | Translations that update when the language does |
| `@firsthandjs/devtools` | Seeing what updates what, while developing      |
| `@firsthandjs/testing`  | Tests                                           |

## Without a build step

`@firsthandjs/jsx-runtime` runs JSX at runtime with identical semantics and no
template hoisting — the path [Without Vite](#without-vite) describes. It is
also what a REPL, a sandbox or a test that imports TSX directly ends up using.
It is correct everywhere; the compiled path is where the performance comes
from, so production should have the compiler.

---

Next: [Reactivity](02-reactivity.md) — signals, computeds, effects, and exactly
when the DOM changes.
