# ADR-0008: A logical owner tree, independent of the DOM

Status: accepted (Phase 1)

## Problem

Context resolution, disposal, error ownership and portal semantics all need a
notion of "parent". The physical DOM parent is the wrong answer for portals, and
walking the DOM is the wrong answer for performance.

## Constraints

- Context must survive portals: the physical parent must not become the logical
  parent.
- Context must work with shadow DOM, where DOM traversal crosses boundaries
  awkwardly.
- No repeated DOM traversal in the hot path.
- Disposal must be complete and O(size of the disposed subtree).
- Components are hostless by default (ADR-0003), so there may be no DOM node to
  hang ownership on at all.

## Options considered

1. **DOM traversal for context** (the `composedPath`/`parentNode` walk used by
   many web-component libraries, or a `context-request` event). Portals break it
   by construction, shadow boundaries complicate it, and every lookup is O(depth)
   of the DOM.
2. **`context-request` DOM event protocol.** Good for interop with foreign
   components, but allocates an event per lookup, is bound to the physical tree,
   and cannot express "resolve once, then subscribe".
3. **A logical owner tree maintained by the framework.** Components, branches,
   list rows and portals push an owner; the current owner is a module-level
   variable during setup.

## Chosen design

Option 3. An `Owner` is a plain object with a parent pointer, an intrusive child
list, a lazily created disposal array and a lazily created, prototype-chained
context record.

- **Context**: `provide` writes into the owner's context record, which is
  `Object.create(parentRecord)`. `useContext` resolves once at setup time via a
  single prototype-chain property lookup and then holds the provider's cell
  directly; subsequent reads cost exactly one signal read. Nested providers cost
  nothing extra at read time.
- **Portals**: created under the current owner, appended to a foreign DOM
  parent. Nothing in context, disposal, error handling or reactivity consults
  the DOM, so the portal behaves as if it were where it was written.
- **Disposal**: a post-order walk of the owner subtree.

Option 2 remains available as an interop _adapter_ for consuming third-party
`context-request` providers; it is not the internal mechanism.

## Performance implications

- Context read in steady state: one signal read. No traversal, no map lookup, no
  event allocation.
- Context change with 10 000 consumers: 10 000 effect runs, each updating one
  DOM part — no tree walking, no re-render.
- Owner creation: one small object per component/branch/row.

## Memory implications

One owner per scope, with arrays allocated only when something is actually
registered. A disposed subtree drops its owners, its context records and its
links in one pass.

## DX implications

The rule "ownership is where you wrote it, not where the DOM ended up" is simple
and matches intuition. The one sharp edge: creating reactive scopes outside any
owner (e.g. at module top level) leaves them un-owned; `createRoot` makes that
explicit and returns a `dispose`.

## Rejected alternatives

DOM traversal (breaks portals, O(depth), shadow complications), event-based
context (allocation per lookup, physical-tree bound).
