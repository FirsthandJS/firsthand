# React interop

[Index](../README.md) · Previous: [Web components](10-web-components.md) ·
Next: [Testing](12-testing.md)

---

Some component libraries are written for React and nothing else. MUI, Radix,
Ant, react-select: they need React's reconciler to run, so
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

A bridge brings React and react-dom with it — **about 45 kB gzip**, against
5.86 kB for this runtime — and below the bridge the React model applies: its
reconciler, its re-renders, its synthetic events. That is not a flaw; it is
what you are asking for when you use a React component, and it works exactly as
it does in a React application. The bridge is fine-grained on the Firsthand side
only: one effect re-renders the React root when a prop it reads changes.

Worth it for a component you would not want to write again; less obviously
worth it for something small:

| You want                                                                  | A reasonable choice                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A button, a card, a layout                                                | Elements, or [`@firsthandjs/styled`](07-styling.md)         |
| A whole design system                                                     | A [web-component one](10-web-components.md) needs no bridge |
| A date picker, a data grid, a rich text editor that exists only for React | This package                                                |

If React is already in your bundle for other reasons, the first row matters
much less — the 45 kB is paid either way.

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

It is not a React compatibility layer. Firsthand does not implement `useState`
and does not run React components without React — it runs them _with_ React,
which is the only way to get React's semantics exactly right. Reimplementing
them would mean maintaining a second, less complete React, and your components
deserve the real one. The reasoning is in
[ADR-0016](../adr/0016-interop-with-component-libraries.md).

---

Next: [Testing](12-testing.md).
