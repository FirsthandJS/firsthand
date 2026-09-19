# ADR-0017: Element types this framework does not own

**Status:** accepted · 2026-09-19

## Problem

A React component is a function, and TSX is happy to write it as an element.
Firsthand could not run one: `createComponent` called `target.setup`, which a
React component does not have, and the failure was a `TypeError` about
`undefined` rather than an explanation.

So every React component had to be wrapped by hand — `const Button =
fromReact(MuiButton)` — once per component, at module level, before it could
appear in a view. For an application built on MUI that is a file of nothing but
wrappers, and the wrapping is not information: it says "this is React", which
the import already said.

The request was to place them directly, **if** that could be done without
putting React-specific code outside the React packages.

## Constraints

- `@firsthandjs/dom` must not know what React is. An application that never
  installs React must not pay for it, in bytes or in concepts.
- The ordinary path — a Firsthand component — must not get slower.
- One adapted component per component _type_. A bridge holds a React root, so
  adapting the same function twice would be two component types, and a keyed
  list would rebuild rows that merely re-read it.
- TSX has to accept the element, and `JSX.ElementType` is a single type alias
  in `@firsthandjs/jsx-runtime`. It cannot name React either.

## Options

1. **Detect React in `createComponent`.** Smallest code, and wrong: it puts
   `react` in the runtime's vocabulary and in its bundle graph.
2. **Compiler support.** The compiler cannot know what an imported binding is;
   whether `Button` is a React component is not visible in the module it is
   used from.
3. **A registered adapter in the runtime, filled by the React package.** One
   slot, one cache, one error. Nothing in the runtime names a framework.

## Chosen design

Option 3. `@firsthandjs/dom` exports `setComponentAdapter(adapter)`; when
`createComponent` is handed something without a `setup`, it asks the adapter,
caches the result per target, and instantiates it. With no adapter installed it
throws `FirsthandComponentError`, whose message names both ways out.

`@firsthandjs/react/auto` is a side-effect module that installs an adapter calling
`fromReact`, and augments the JSX namespace. The namespace hook is an empty
interface, `JSX.ForeignElementTypes`, declared in `@firsthandjs/jsx-runtime`:
`keyof` an empty interface is `never`, so it contributes nothing until a
package merges into it. That package names React; the runtime does not.

## Performance

The check is one property read on the ordinary path — `target.setup ===
undefined` — rather than an `in` test, and only a foreign type takes the branch.
`@firsthandjs/dom` grew from 3.87 kB to 4.15 kB gzip, which is the seam plus the
error message; `@firsthandjs/react/auto` is 0.65 kB and only exists if imported.

Runtime cost per bridged component is unchanged, because it is the same bridge:
one React root per instance, one adapter call per component type.

## DX

`<Button variant="contained">Save</Button>` after one import, with the
component's own props checked. Two things a direct element cannot express,
stated in the docs rather than worked around:

- `children` are React's `ReactNode`, so a Firsthand component as a child of a
  directly-placed React component does not type-check. `fromReact` types
  `children` as `View`, and that is the case it exists for.
- `host` and `class` are the bridge's own props and have nowhere to go.

Because the JSX augmentation is global to a TypeScript program, importing
`@firsthandjs/react/auto` anywhere makes React components valid element types
everywhere in that program. That is how declaration merging works, and it is
the price of the types being checkable at all.

## Rejected alternatives

- **Widening `JSX.ElementType` to any function.** It would accept a helper that
  returns a number as a component and report nothing.
- **A `<React>` wrapper element.** `<React component={Button} …/>` is
  `ReactHost`, which already exists; it mounts a root per instance and reads
  worse than the element it replaces.
- **Making the adapter implicit in `@firsthandjs/react`.** Importing `fromReact`
  would then change how unrelated element types behave. An opt-in with its own
  module name says what it does.
