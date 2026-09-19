# ADR-0003: Hostless components by default, custom element host opt-in

Status: **accepted**, and re-validated with measurements (2026-09-19)

## Problem

The framework is specified as being built on native Web Components, and
framework components must be able to use real custom elements as a host and to
be exported as public web components. At the same time it must mount 100 000
rows competitively, and components are expected to be used as freely as
functions.

## Constraints

- `customElements.define` requires a class extending `HTMLElement`.
- Creating an upgraded custom element runs a constructor, enqueues custom
  element reactions and fires `connectedCallback` — work a cloned template
  subtree does not do.
- An element host adds one DOM node per component instance, which changes CSS
  selector matching (`.row > td` breaks if a host sits between them).
- The requirement to use real custom elements is explicit and must be met.

## Options considered

1. **Every component is a custom element.** Maximum platform alignment. Costs a
   constructor call, an upgrade reaction and an extra DOM node per instance, and
   forces every consumer's CSS to account for the host element. At 100 000 rows
   this is 100 000 extra elements and 100 000 upgrades.
2. **No custom elements at all.** Fast, but violates an explicit requirement and
   gives up the interop story entirely.
3. **Hostless by default, element host opt-in per component.** Components are
   owner scopes; `defineElement(C)` or `component(fn, { tag: true })` produces a
   real custom element wrapping the same setup function.

## Chosen design

Option 3. The public behaviour is:

```ts
const Row = component(fn); // no host node, no upgrade cost
const Card = component(fn, { tag: true }); // <firsthand-card> host element
defineElement(Widget); // register an existing component
```

Both paths share the setup function, the reactive graph, the owner tree, props
and disposal. A component's identity is unchanged by hosting it.

## Performance implications

The whole point, and now measured rather than assumed
(`npm run bench:micro`, raw data in `benchmarks/results/micro.json`).

Mounting 2000 components of the same component, Chromium, median of
12 repetitions after 3 warmups, variant order rotated:

| Variant                       |            Mount | Update all | DOM nodes |
| ----------------------------- | ---------------: | ---------: | --------: |
| hostless (default)            |     **13.95 ms** |    8.45 ms |      2000 |
| `{ tag: true }`               | 23.15 ms (1.66x) |    9.25 ms |      4000 |
| `{ tag: true, shadow: true }` | 23.90 ms (1.71x) |    9.75 ms |     2000* |

\* the shadowed variant's content lives in a shadow root, so a light-DOM node
count does not see it; it is the same number of nodes plus 2000 shadow roots.

**The original wording overstated the case.** This ADR said the cost was "large
enough to dominate a mass mount". It is 1.5x-1.7x on mount, depending on the
run — 1.51x when this table was first written, 1.66x on the latest — and about
10 % on update. Real, and it doubles the node count, but it does not dominate.
Both runs are in the git history of this file; neither is cherry-picked. The
decision stands on the corrected number: paying 50 % more mount time and twice
the DOM for a boundary most components do not need is the wrong default, and
the applications that want it can ask for it per component.

## Memory implications

An element host retains a DOM node, its internal element state and a reference
from the custom element registry's upgrade machinery. Hostless components retain
only their owner object. Measured: 2000 components become 4000 DOM nodes
instead of 2000 — exactly one extra node each.

## DX implications

- Positive: no surprise wrapper elements breaking CSS; components compose like
  functions.
- Negative: "it's built on Web Components" is true of the interop boundary, not
  of every internal node. This must be stated plainly in the README rather than
  implied otherwise — doing so is part of this ADR.
- The opt-in is one option, and the tag name is derived automatically from the
  package prefix and the component's stable id, so no name strings are repeated.

## Rejected alternatives

Option 1 (universal custom elements): rejected on cost, now quantified at
1.5x-1.7x mount time and twice the DOM nodes. That is smaller than this ADR
originally implied, and it is still the wrong thing to charge every application
for by default. Option 2 (no custom elements): rejected because it violates an
explicit requirement and removes the interop path.

Measured on Chromium only. If another engine turns out to make element upgrade
cheap, the number to re-run is `npm run bench:micro`.
