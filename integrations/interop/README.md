# Using other people's components

Three ways, side by side, in one page — so that "Firsthand works with MUI" is
something you can run rather than something this repository asserts.

```bash
cd integrations/interop
npm install
npm run dev     # http://localhost:5173
npm test        # builds it and drives all three in Chromium
```

Like the Storybook integration, it is deliberately **not** part of the root
workspace: nobody should have to install MUI to work on the framework.

## The three ways, and what they cost

| Approach                           | Adapter needed                | Downloads                         | Verdict                                                        |
| ---------------------------------- | ----------------------------- | --------------------------------- | -------------------------------------------------------------- |
| **Web components** (Shoelace here) | none                          | the library                       | Use this where the library exists                              |
| **React components** (MUI here)    | `@firsthandjs/react`, 0.60 kB | the library **+ ~45 kB of React** | An escape hatch worth taking for a data grid, not for a button |
| **`@firsthandjs/styled`**          | none                          | 1.97 kB                           | When you want to write the component yourself                  |

This page, with MUI and Shoelace both on it, is **145 kB gzip**. The framework
is 5.6 kB of that. The number is the point: interop is available, and it is not
free.

### Web components need nothing

```tsx
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

<sl-switch
  checked={dark.value}
  on:sl-change={(event) => (dark.value = event.currentTarget.checked)}
>
  Dark
</sl-switch>;
```

A custom element is an element. Properties are properties, and `on:sl-change`
takes the event name verbatim — no casing of an identifier produces a hyphen,
which is why that form exists. Material Web, Fluent, Vaadin and Carbon are the
same story.

### React components need a React

```tsx
import '@firsthandjs/react/auto'; // once, at startup
import MuiAlert from '@mui/material/Alert';

<MuiAlert severity="info">Written directly, with no bridge declared.</MuiAlert>;
```

```tsx
import { fromReact } from '@firsthandjs/react';
import MuiButton from '@mui/material/Button';
const Button = fromReact(MuiButton); // the explicit form, for Firsthand children

<Button variant="contained" onClick={() => clicks.value++}>
  MUI button
</Button>;
```

Both are on the page, and they are the same bridge: a React root per instance,
re-rendered when a prop it reads changes. Below it, React all the way down;
above it, nothing changed.

Each root is its own React tree, so React context does not flow between them.
`setReactWrapper` puts one MUI `ThemeProvider` around every root, and the
Shoelace switch — on the other side of the page — moves both halves at once.

### Styled components need neither

```tsx
const Swatch = styled.span<{ $hue: number }>`
  background: hsl(${(props) => props.$hue} 70% 55%);
`;
```

`npm test` checks the thing worth checking: five swatches with five different
hues produce **one** rule in the stylesheet, because the hue is a value
interpolation and becomes a custom property.

## What `npm test` asserts

Eleven checks, in a real browser, against the built page:

1. a custom element really upgraded, and its click reaches a Firsthand signal;
2. `on:sl-change` — an event whose name has a hyphen — reaches a handler;
3. a property set from a signal updates the custom element;
4. MUI renders through the bridge (its own classes are on the element);
5. a React event updates a Firsthand signal, and that signal updates a React prop;
6. a MUI slider drives a Firsthand signal;
7. five styled instances with different values share one rule;
8. a block interpolation swaps the class;
9. a React component written directly as an element renders;
10. one MUI theme reaches every bridged root, from a switch outside React;
11. a styled component styled again wins on specificity.
