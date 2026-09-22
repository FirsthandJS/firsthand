# ADR-0027: Server rendering is a second compiler target, and hydration adopts

**Status:** accepted · 2026-09-22 · extends
[ADR-0005](0005-props-are-accessors.md), [ADR-0009](0009-compiler-templates-and-thunks.md),
[ADR-0022](0022-resources-not-a-cache.md)

## Problem

A page that arrives empty and fills itself in is slower to read, worse to index
and worse to share. Server rendering fixes that, and hydration is what stops
the browser from throwing the result away.

Firsthand had neither, and the way it renders makes both harder than they are
in a framework with a virtual DOM. There is no tree of descriptions to
serialise: the compiler turns markup into a `<template>` and a set of parts
that write into it, and both of those are DOM objects. A server has no DOM.

## Constraints

- **Every feature, not a subset.** "Server rendering works if you write your
  components a particular way" is not server rendering. Components, view
  functions, render functions, keyed lists, context, fragments, spreads,
  custom-element hosts and data all have to work, with the source unchanged.
- **The non-SSR experience must not get worse.** An application without a
  server must not pay for one — not in bundle size, not in the hot path.
- **Faster than the alternative.** Specifically faster than Solid, which
  renders the same way and is the fastest of the frameworks measured here.
- **One semantics.** What the server renders and what the browser renders have
  to be the same thing, and that has to be _asserted_, not asserted-to.

## Options

**1. Render to a DOM emulation on the server, then serialise it.** Works
immediately, needs no compiler work, and is what a framework that has run out
of ideas does. It is also five to ten times slower than building a string, and
it makes every DOM quirk a dependency of the server.

**2. A virtual DOM for the server only.** Two renderers, two sets of bugs, and
the component model would have to be expressible in both.

**3. A second compiler target.** The compiler already turns JSX into calls
against a named protocol (`@firsthandjs/dom/internal`). Emit the same shapes
against a different protocol — `@firsthandjs/server/internal` — where markup is
a string rather than a tree. Chosen.

## Chosen design

### The compiler has an `ssr` mode

One flag, set by the bundler. Vite already tells a plugin which build it is
running, so an application configures nothing:

```
<p class="lead">Hello, {name}!</p>

DOM      template("<p class=\"lead\">Hello, <!>!</p>") + insert(el, () => name, marker)
server   ssr(["<p class=\"lead\">Hello, <!--[-->", "<!---->!</p>"], child(name))
```

The same traversal, the same `planChildren`, the same attribute rules. What
differs is what gets emitted at the end.

### Hydration adopts, and the markup says where the seams are

`template()` in a hydrating render hands back a node the server sent instead of
a clone, and a dynamic child finds its content in place instead of creating it.
That needs one thing the markup does not otherwise say: **where each dynamic
child begins**. Its content has a length the template does not.

So the server marks it. `<!--[-->` opens a region; the marker the browser's own
template has at that position closes it. Two consequences, and they are the
whole of the design:

- **Navigation still works.** `firstChild.nextSibling` would walk into a
  region's content. A build compiled with `hydratable` walks through `first`
  and `next`, which step over a whole region in one move.
- **Text does not run together.** The parser reads `Hello, ` and a dynamic
  `Ada` as one text node; the opening comment sits between them, so the part
  gets a text node of its own to write to.

A dynamic child that is the **whole** of its element's content gets no marker
at all — where the element's children start is where the region starts, and
the client can see that for itself. That is the common case (`<td>{id}</td>`),
and leaving the marker out brought the markup down to exactly the size of a
document with no hydration bookkeeping in it at all: byte for byte what Vue
and React send, and 7 % smaller than Solid.

The markers are in the server's markup only. A build without SSR emits neither
them nor the navigation helpers.

### Hydration is its own entry point

`@firsthandjs/dom/hydrate`, not `@firsthandjs/dom`. Nothing in the render path
imports it: `template` and `insert` read a holder in `claim.ts` that stays
empty, so a bundle that never imports hydration never contains it. What is left
behind in the ordinary path is one property read and one comparison, in two
places.

That is what keeps the second constraint: the runtime budget is unchanged, and
hydration is 2.0 kB gzip that only an application with a server downloads.

### Data crosses the wire under the name it already has

A resource belongs to its call site (ADR-0022), so it has no key to be
serialised under. A **named** resource does: `persist` is a name the
application chose, and a name is exactly what state transfer needs.

```tsx
const notes = useResource(({ signal }) => listNotes(signal), { persist: 'notes' });
```

The server fills a `createMemoryStorage()` under that name,
`renderToStringAsync` waits for it via `store.settle()`, `storage.dump()` goes
into the page, and the browser starts from `createMemoryStorage(sent)` — where
the resource finds its value **during its first run**, which is what makes the
first paint the markup rather than a spinner replacing it.

A resource without a name still renders on the server. It arrives in the
browser unanswered, because there is nothing to put it under. That is a
decision the call site makes, in one word, and can see.

### What a server does not do

- **Effects do not run.** An effect is a side effect over time, and a render
  that produces one string has none. `setRendering` in the core is the switch.
- **Refs and handlers are not emitted.** There is no node to hand to a ref and
  nobody to click. Both are attached during hydration, where they are the only
  things left to do.
- **Scopes are not created until something needs one.** Most components on a
  server are a function that reads its props and returns markup, and those have
  nothing to take apart. `deferOwner` describes the scope; the first `provide`,
  `signal` or `onCleanup` makes it.
- **Props that nobody could notice being read are read eagerly.** A name, a
  member chain, a literal and the operators over them are written into the
  props object as values rather than accessors: on a server a prop is read once
  and nothing can change under it. A call, an assignment or an `await` keeps
  its accessor, because evaluating _those_ early could be seen.

## Performance

Measured by `benchmarks/ssr/run.mjs` and `benchmarks/ssr/hydrate.mjs`, with the
same rules the browser benchmark keeps: the output is compared before anything
is timed, the frameworks are interleaved in one process, the build is the
production build on every side, and the loser is published.

1 000 rows, each with an id, a link, a class that depends on state and a
handler:

|                  | Firsthand    | Solid     | Vue       | React     |
| ---------------- | ------------ | --------- | --------- | --------- |
| render to markup | **0.171 ms** | 0.205 ms  | 15.02 ms  | 199.67 ms |
| markup size      | 222 802 B    | 238 694 B | 222 802 B | 222 802 B |
| hydrate          | **4.12 ms**  | 4.62 ms   | 10.48 ms  | —         |

React's `hydrateRoot` schedules its work rather than doing it, so a number
taken the same way would be the time to _start_ hydrating. It is left out
rather than reported as something it is not.

Four changes account for almost all of the distance, and each was found by
profiling rather than by guessing:

| Change                                      | Server render |
| ------------------------------------------- | ------------- |
| baseline                                    | 1.381 ms      |
| props not frozen on a server                | 0.741 ms      |
| pure props written as values, not accessors | 0.234 ms      |
| escaping in one pass, behind a native test  | 0.205 ms      |
| scopes created only when needed             | 0.189 ms      |

`Object.freeze` per component was 46 % of a server render on its own.

## Memory

A server render holds nothing after it returns: the root owner is disposed, so
a computed that subscribed to a module-level signal is unsubscribed rather than
left pointing at it from the next request's graph. `createMemoryStorage` is one
object per request and is the caller's to drop.

## DX

The application is the application. `examples/ssr` renders the same
`src/app.tsx` on both sides; the only files that know a server exists are the
two entry points and four lines of `vite.config.ts`.

Where the two sides disagree:

- A **dynamic** value that disagrees is written, as on any other change.
- A **different element** is not adopted; the browser builds its own.
- **Static markup** that disagrees is kept as the server wrote it, because
  static markup is what nothing ever writes again. Development names it.

## Rejected alternatives

- **A DOM emulation on the server.** Option 1 above. Slower by an order of
  magnitude, and it makes a DOM implementation part of the server's
  dependencies.
- **Hydration keys as attributes** (`data-hk`, as Solid does). They survive in
  the DOM for ever and they are bytes on every element. Comments cost nothing
  after hydration removes them, and there are fewer of them: one per dynamic
  child rather than one per element.
- **Making the browser's props eager too.** It would be faster at mount and
  wrong: a prop is an accessor so that a child's read subscribes to whatever
  the parent read, which is the whole of ADR-0005.
- **A `hydratable` default.** The navigation helpers cost a call where a
  property read would do. An application without a server should not pay for
  one, so it is a flag the project sets once.
- **Deferring the marker sweep out of `hydrate()`.** It would have made the
  benchmark look better and the page no better. The markers are removed inside
  the measured window.
