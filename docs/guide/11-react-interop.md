# React interop

[Index](../README.md) · Previous: [Web components](10-web-components.md) ·
Next: [Testing](12-testing.md)

---

Some component libraries exist only as React components. MUI, Radix, Ant,
react-select: none of them can run without React's reconciler, so
`@firsthandjs/react` mounts one.

```bash
npm install @firsthandjs/react react react-dom
```

```tsx
import '@firsthandjs/react/auto'; // once, at startup
import Button from '@mui/material/Button';

<Button variant="contained" onClick={save}>
  Save
</Button>;
```

That import installs an adapter for element types Firsthand does not own, and
teaches TSX about React's component type. Nothing else is needed for a
component whose children are text, a number, or nothing at all.

### When to declare a bridge instead

```tsx
import { fromReact } from '@firsthandjs/react';
import MuiCard from '@mui/material/Card';

const Card = fromReact(MuiCard, { host: 'div' });

<Card>
  <MyFirsthandComponent /> {/* Firsthand children, inside a React component */}
</Card>;
```

A directly placed React component types its `children` as React's `ReactNode`,
and a Firsthand element is not one. `fromReact` types them as a `View`, which is
the case it exists for; it also takes the bridge's own `host` and `class`
props, which a direct element has nowhere to put.

It is the same bridge either way — created once per component type — so
neither form is cheaper, and neither hides anything. Without the `auto` import,
writing a React component as an element throws `FirsthandComponentError`, which
says which of the two to do.

[`integrations/interop`](../../integrations/interop/) drives MUI's `Button`,
`Chip`, `Slider` and a directly placed `Alert` in Chromium — both forms on one
page, in a real browser, on every run of its `npm test`.

## One theme for both halves

Each bridge mounts **its own React root**, so React context does not flow from
one bridged component to another: a `<ThemeProvider>` rendered through one
bridge cannot reach a `<Button>` rendered through another. Providers therefore
go around every root:

```tsx
import { createElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { setReactWrapper } from '@firsthandjs/react';

setReactWrapper((node) => createElement(ThemeProvider, { theme: muiTheme(theme.value) }, node));
```

Reading `theme.value` inside the wrapper is an ordinary reactive read, so one
switch restyles every bridged component — and nothing that is not one.
[`integrations/interop`](../../integrations/interop/) asserts exactly that: its
theme switch lives outside React, and the MUI surfaces follow it.

The same applies to every React context an application relies on: a query
client, an i18n provider, a router of React's own. They belong in the wrapper.

## What it costs

React and react-dom are **about 45 kB gzip**, eight times this framework's
runtime. Everything below a bridge is React's: its reconciler, its re-renders,
its synthetic events. The bridge is fine-grained on the Firsthand side only — one
effect re-renders the React root when a prop it reads changes.

So the size of what you are reaching for should decide:

| You want                                                                  | Use                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A button, a card, a layout                                                | Elements, or [`@firsthandjs/styled`](07-styling.md)               |
| A design system                                                           | A [web-component one](10-web-components.md) — no bridge, no React |
| A date picker, a data grid, a rich text editor that only exists for React | This package                                                      |

The middle row is the one people miss.

## How it behaves

**Call `fromReact` once, at module level.** Each _instance_ mounts its own
React root, so creating the bridge inside a component would create a root per
instance of the surrounding page. Keeping the declared bridges in one file also
makes it obvious where React contains Firsthand — that file becomes the list of
those places. A direct element needs none of this: the adapter caches one
bridge per component type for you.

**Props are forwarded, except two.** `class` goes on the host element, and
`host` chooses the host tag (`span` by default, so inline layout survives).
Everything else reaches the React component untouched, including functions, so
callbacks work in both directions.

**Children stay Firsthand's.** React cannot render DOM nodes, so the bridge gives
Firsthand its own element inside the React tree and fills it through the ordinary
insert. Reactive children update without React hearing about it:

```tsx
<MuiCard>
  <p>{count.value}</p> {/* a text write, not a React render */}
</MuiCard>
```

**Disposal unmounts the root**, in a microtask — React refuses to unmount a
root while it is rendering, and a Firsthand disposal can happen inside an effect a
React event started.

## Events across the boundary

MUI's props are React's, so their signatures are React's:

```tsx
<MuiTextField
  value={text.value}
  onChange={(event: { target: { value: string } }) => (text.value = event.target.value)}
/>

<MuiSwitch checked={on.value} onChange={(_event: unknown, next: boolean) => (on.value = next)} />
```

Writing a signal from a React handler is ordinary: the write flushes
synchronously, the Firsthand parts update, and the React subtree re-renders only
if one of _its_ props changed.

## Choosing a component at runtime

```tsx
<ReactHost component={whichever} props={{ variant: 'contained' }} host="div" />
```

It mounts a root per instance either way, so prefer `fromReact` where the
component is known.

## Two copies of React

Linking the package from a monorepo rather than installing it can give your
bundler two copies of React and a null hooks dispatcher:

```
TypeError: Cannot read properties of null (reading 'useContext')
```

```ts
// vite.config.ts
resolve: {
  dedupe: ['react', 'react-dom'];
}
```

An installed package has one copy and needs none of this.

## What this is not

It is not a React compatibility layer. Firsthand does not implement `useState`,
does not run React components without React, and will not: that would be a
second framework, and a worse one than React at being React. The reasoning is
in [ADR-0016](../adr/0016-interop-with-component-libraries.md).

---

Next: [Testing](12-testing.md).
