# ADR-0016: Web components first, and a React bridge for the rest

Status: **accepted** (2026-09-19)

## Problem

"Can I use MUI?" is the question that decides whether a framework is usable at
work. Behind it are three different questions with three different answers, and
conflating them is how frameworks end up promising compatibility they cannot
deliver:

1. Can I use a **web-component** library — Shoelace, Material Web, Fluent,
   Vaadin, Carbon?
2. Can I use a **React** library — MUI, Radix, Ant, react-select?
3. Can I write components the way styled-components lets me?

## Constraints

- An application that uses none of this must download none of it.
- Whatever is promised must be demonstrated in a browser, not asserted.
- The cost of each route must be stated in bytes, because that is what the
  decision turns on.

## Chosen design

### Web components: nothing at all

A custom element is an element. Firsthand sets properties as properties, forwards
attributes, and delegates events. The only thing missing was event names with
hyphens: `onSlChange` lowercases to `slchange`, and the event is `sl-change`.
No casing of an identifier produces a hyphen.

So `on:` takes the name verbatim — `on:sl-change`, `on:value-changed` — in both
the compiler and the runtime. That is the whole of the change, and it makes
every web-component library usable with an import and no adapter. JSX permits
one colon in an attribute name, so the literal form takes no modifier;
`onClick:capture` remains the way to ask for that.

### React: a bridge, priced honestly

`@firsthandjs/react` is 0.66 kB and mounts a React root per bridged instance.
Props flow in through one effect, children stay Firsthand's (the bridge gives
Firsthand an element inside the React tree and fills it through the ordinary
`insert`, because React cannot render DOM nodes and a Firsthand dynamic child is
not one), and events call back out.

It works — `integrations/interop` drives MUI's Button, Chip and Slider in
Chromium. It also brings React itself, about 45 kB gzip against this
framework's 5.87 kB, and everything below the bridge updates the React way.
Both facts are in the docs rather than buried, and the table there suggests an
element or a web component where one would do, because the bridge is worth its
size for a date picker and not for a button.

### Styling: its own package

[ADR-0015](0015-styling-with-custom-properties.md).

## Performance implications

- Web components: none. The framework does not know they are special.
- The bridge: React's own performance, below the bridge. Above it, one effect
  per bridged instance.
- The interop demo page, with MUI and Shoelace both on it, is 145 kB gzip
  against the framework's 5.6 kB. Published because it is the honest headline
  for this ADR.

## Memory implications

One React root and one host element per bridged instance, released on disposal
— in a microtask, because React refuses to unmount a root while it is
rendering.

## DX implications

- `fromReact(Component)` is called once at module level; doing it inside a
  component would mount a root per instance of the surrounding page.
- Linking the bridge from a monorepo can give the bundler two copies of React
  and a null hooks dispatcher. `resolve.dedupe` fixes it, and the README names
  the error message so it is searchable.
- The `on:` form is one more thing to know, and it only appears when you use a
  library that needs it.

## Rejected alternatives

- **A React compatibility layer** — implementing `useState`, `useEffect` and a
  reconciler so React components run unmodified. That is a second framework,
  and nobody needs a second, less complete React.
- **Wrapping MUI components as web components** to avoid the bridge. It still
  needs React underneath, and adds a custom element to every one.
- **Saying "use web components" and stopping there.** True, unhelpful, and
  false for the data grid somebody has already bought.
- **Vendoring a component library of our own.** A different project, and one
  that would have to be as good as MUI to be worth using.

## Update, after using it

Two things were missing once an application was actually built on this.

**React context does not cross bridge boundaries.** Each bridge mounts its own
React root, so a `ThemeProvider` rendered through one bridge cannot reach a
button rendered through another — they are separate trees. MUI therefore kept
its default theme while the rest of the page changed. `setReactWrapper(fn)`
wraps every bridged root in the same elements, and because the wrapper is read
inside each root's render effect, a signal read in it makes one theme switch
re-render every bridged component and nothing else.

**Declaring a bridge per component is noise where it carries no information.**
`@firsthandjs/react/auto` makes a React component an ordinary element; it is the
same bridge, cached per component type. `fromReact` remains for the case the
types cannot express — a React component wrapping Firsthand children — and for the
bridge's own `host` and `class` props. See
[ADR-0017](0017-foreign-element-types.md) for the seam that makes it possible
without `@firsthandjs/dom` naming React.
