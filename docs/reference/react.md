# @firsthandjs/react

[Reference index](../README.md#reference) · 0.66 kB gzip · peer dependencies
`react` and `react-dom` (18 or 19)

Runs a React component inside a Firsthand tree, which is how MUI, Ant Design,
Chakra and the rest work here. Guide:
[React interop](../guide/11-react-interop.md).

---

## fromReact

```ts
function fromReact<P extends object>(
  Component: ComponentType<P>,
  options?: { host?: keyof HTMLElementTagNameMap },
): Component<BridgeProps<P>>;

type BridgeProps<P> = Omit<P, 'children'> & {
  readonly children?: View;
  /** Put on the element React renders into, not passed to the component. */
  readonly class?: string;
  /** The element to mount into. `span` by default, so inline layout survives. */
  readonly host?: keyof HTMLElementTagNameMap;
};
```

```tsx
import MuiButton from '@mui/material/Button';
const Button = fromReact(MuiButton);

<Button variant="contained" onClick={save}>
  Save {count.value}
</Button>;
```

**Call it once, at module level**, next to the import. A bridge created inside
a component body would mount a new React root per instance.

`children` is typed `View`, not `ReactNode`, because what you write inside a
bridged component is **Firsthand's**: it is rendered into an element Firsthand owns
and adopted into the React tree, so a reactive child updates without React
hearing about it.

One effect drives the whole React tree — React's unit of work is the tree, so
splitting props across effects would only re-render it several times for one
change. Props are forwarded as they are, except `class` and `host`.

Unmounting is deferred to a microtask, because React refuses to unmount a root
while it is rendering and a Firsthand disposal can happen inside an effect that a
React event handler started.

## @firsthandjs/react/auto

```tsx
import '@firsthandjs/react/auto';
import Button from '@mui/material/Button';

<Button variant="contained" onClick={save}>
  Save
</Button>;
```

Importing this module once installs an adapter for element types Firsthand does
not own, and adds React's component type to the JSX namespace. It is still
`fromReact` underneath — still one React root per instance — and the bridge is
created once per component type and cached.

Two things it cannot do, both from React's own types:

- `children` are `ReactNode`, so a **Firsthand** component as a child of a
  directly-placed React component does not type-check. That is what
  `fromReact` is for: its `children` are `View`.
- `host` and `class` are not available, because a direct element passes
  everything it is given to React.

Without the import, a React element throws `FirsthandComponentError`, naming this
module.

## setReactWrapper

```ts
function setReactWrapper(wrapper: ReactWrapper | null): void;
type ReactWrapper = (node: ReactNode) => ReactNode;
```

```tsx
import { createElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';

setReactWrapper((node) => createElement(ThemeProvider, { theme: muiTheme(theme.value) }, node));
```

**Each bridge mounts its own React root, so React context does not flow from
one bridged component to another.** A `<ThemeProvider>` written as one bridged
element cannot reach a `<Button>` written as another: they are separate trees.
This wraps every bridged root in the same elements, which is where a provider
tower belongs.

Reading a signal inside the wrapper — `theme.value` above — is an ordinary
reactive read, so changing it re-renders every bridged component and nothing
else. `null` removes the wrapper again.

## ReactHost

```tsx
const ReactHost: Component<{
  readonly component: ComponentType<never>;
  readonly props?: Record<string, unknown>;
  readonly host?: keyof HTMLElementTagNameMap;
}>;

<ReactHost component={Button} props={{ variant: 'contained' }} />;
```

For a component chosen at runtime. It mounts a root per instance, so prefer
`fromReact` where the component is known.

## Bundler note

Two copies of React in one bundle produce
`Invalid hook call. Hooks can only be called inside of the body of a function
component.` Deduplicate them:

```ts
// vite.config.ts
resolve: {
  dedupe: ['react', 'react-dom'];
}
```

## What it costs

One React root per bridged instance, and React's own reconciliation for what is
inside it. That is the honest price of using a React component; it does not
make the rest of the application re-render, and nothing outside the bridge pays
for it. Numbers are in the [performance guide](../guide/14-performance.md).
