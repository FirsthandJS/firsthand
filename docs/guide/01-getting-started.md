# Getting started

[Documentation index](../README.md) · Next: [Reactivity](02-reactivity.md)

---

## Install

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

That is the whole setup. `jsx: "preserve"` leaves TSX for the plugin to
compile; `jsxImportSource` is what makes `<div>` and `<Counter />` type-check
in your editor. Nothing else — no `esbuild.jsx`, no runtime configuration.

`packageName` is used to derive stable component ids and custom element names.
Any string does; it should be stable across builds.

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

| Package                 | When you need it                               |
| ----------------------- | ---------------------------------------------- |
| `@firsthandjs/dom`      | Always. Components, rendering, signals         |
| `@firsthandjs/compiler` | Always, as a dev dependency                    |
| `@firsthandjs/router`   | More than one page                             |
| `@firsthandjs/query`    | Talking to a server                            |
| `@firsthandjs/styled`   | Styles written next to the component           |
| `@firsthandjs/react`    | A component library that only exists for React |
| `@firsthandjs/testing`  | Tests                                          |

## Without a build step

`@firsthandjs/jsx-runtime` runs JSX at runtime with identical semantics and no
template hoisting. It exists for a REPL, a sandbox or a test that imports TSX
directly — not for production, because the compiled path is where the
performance comes from.

---

Next: [Reactivity](02-reactivity.md) — signals, computeds, effects, and exactly
when the DOM changes.
