# @firsthandjs/react

React components inside Firsthand — for MUI, and for every other library
written for React.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/11-react-interop.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/react.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/react react react-dom
```

0.66 kB gzip. React and react-dom are peer dependencies: an application that
never imports this package does not install them.

```tsx
import Button from '@mui/material/Button';
import { fromReact } from '@firsthandjs/react';

const MuiButton = fromReact(Button);

<MuiButton variant="contained" onClick={save}>
  Save
</MuiButton>;
```

That works. [`integrations/interop`](../../integrations/interop) builds it and
drives it in Chromium: MUI's `Button`, `Chip` and `Slider`, a React event
calling back into a Firsthand signal, and a Firsthand signal updating a React prop.

## React components as elements

```tsx
import '@firsthandjs/react/auto'; // once, at startup
import Button from '@mui/material/Button';

<Button variant="contained" onClick={save}>
  Save
</Button>;
```

Same bridge, same cost, one import instead of one wrapper per component. Use
`fromReact` where you need Firsthand children — a direct element types `children`
as React's `ReactNode` — or the bridge's `host` and `class` props.

## One provider for every root

Each bridge mounts its own React root, so React context does not flow between
them: a `ThemeProvider` rendered through one bridge cannot reach a button
rendered through another.

```tsx
import { createElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { setReactWrapper } from '@firsthandjs/react';

setReactWrapper((node) => createElement(ThemeProvider, { theme: muiTheme(theme.value) }, node));
```

Reading a signal in the wrapper makes one theme switch re-render every bridged
component, and nothing else.

## What it costs

React and react-dom are **about 45 kB gzip**, eight times this framework's
entire runtime. Everything below a bridge is React's: its reconciler, its
re-renders, its synthetic events. The bridge is fine-grained on the Firsthand side
only — one effect re-renders the React root when a prop it reads changes, and
the subtree below then behaves exactly as it does in a React application.

So this is an escape hatch, and the size of the thing you are escaping to
should decide whether to use it:

| You want                                                                  | Use                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A button, a card, a layout                                                | Plain elements, or [`@firsthandjs/styled`](../styled)                                                                                             |
| A design system                                                           | A **web-component** one: Shoelace, Material Web, Fluent, Vaadin, Carbon. They are custom elements, so Firsthand uses them with nothing in between |
| A date picker, a data grid, a rich text editor that only exists for React | This package                                                                                                                                      |

The middle row is the one people miss. A web-component library needs no bridge,
no adapter and no React — see the interop integration, which uses Shoelace with
nothing but an import.

## How it behaves

**Call `fromReact` once, at module level.** Each _instance_ mounts its own
React root, so creating the bridge inside a component would create a root per
render of the surrounding page.

**Props are forwarded, except two.** `class` goes on the host element, `host`
chooses the host tag (a `span` by default, so inline layout survives).
Everything else reaches the React component untouched — including functions, so
callbacks work in both directions.

**Children stay Firsthand's.** React cannot render DOM nodes, and a Firsthand dynamic
child is a deferred part rather than a node, so the bridge gives Firsthand its own
element inside the React tree and fills it through the ordinary `insert`.
Reactive children update without React hearing about it:

```tsx
<MuiCard>
  <p>{count.value}</p> {/* updates as a text write, not a React render */}
</MuiCard>
```

**Disposal unmounts the root**, in a microtask — React refuses to unmount a
root while it is rendering, and a Firsthand disposal can happen inside an effect a
React event started.

## `ReactHost`

For a component chosen at runtime:

```tsx
<ReactHost component={whichever} props={{ variant: 'contained' }} host="div" />
```

It mounts a root per instance either way, so prefer `fromReact` where the
component is known.

## Two copies of React

If you link this package from a monorepo rather than installing it, your
bundler may resolve its `react` import and your application's to two different
copies, and React's hooks dispatcher will be `null`:

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
