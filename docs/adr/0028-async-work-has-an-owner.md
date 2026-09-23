# ADR-0028: Async work has an owner

**Status:** accepted · 2026-09-22 · extends
[ADR-0008](0008-owner-tree-for-context-and-portals.md),
[ADR-0006](0006-synchronous-scheduling.md)

## Problem

The owner tree already knows how to end things. An effect that runs again calls
`clearScope` first, so everything the previous run made is disposed before the
new one starts; a component that goes away takes everything under it with it.
That mechanism is what makes "one committed reality" true of synchronous work.

It cannot reach a promise. An `await` resumes with no ambient owner at all, so
after the first suspension the continuation belongs to nothing:

```ts
onClick={async () => {
  const saved = await save(draft.value);
  onCleanup(() => ...);   // warns: outside any scope. Never runs.
  useContext(Theme);      // not the component's context
  status.value = saved;   // the component may be long gone
}}
```

`runWithOwner` does not fix this, and cannot: it is `setOwner` plus a `finally`,
which is a synchronous bracket. This is the same limitation Solid documents for
its own owner model, and it is ours.

The consequence is a write that lands on nobody. `write()` does not check
`DISPOSED`, and `disposeCell` has already unlinked the subscribers, so a stale
continuation writing to a dead component's signal changes a value, propagates
to no one, throws nothing and logs nothing. It is the least visible class of
bug this framework can produce.

`@firsthandjs/data` had already run into all of it. `useResource` aborts on
re-run, re-checks `entry.disposed` after every `await`, and re-runs when tags
arrive late; `useAction` hand-wrote the same abort-and-guard a second time. Two
copies of one rule is the usual sign that a primitive is missing.

## Constraints

- **The existing rule, applied somewhere new.** Supersession must not become a
  second mechanism with its own semantics. If the owner tree already ends
  things, async has to be ended by the owner tree.
- **No transform required.** The runtime must be correct when it is written by
  hand. A compiler convenience may come later; it may not be load-bearing.
- **Nothing ambient.** No async context tracking, no monkey-patched `await`, no
  global "current task". What the source says is what runs.
- **Nothing in the production budget for applications that never import it.**

## Decision

A `task` is the adapter between the owner tree and a promise.

```ts
effect(() => {
  task(async ({ signal, resume }) => {
    const user = await resume(fetchUser(id.value, { signal }));
    profile.value = user; // reached only while this is still the current run
  });
});
```

It holds an `AbortController`, hangs a scope off the current owner, and asks
that owner to abort it on disposal. That is all it is. Supersession is not
implemented here at all — it falls out of `clearScope`, because an effect that
runs again disposes the task the previous run started, which aborts it, which
makes the old run's next `resume` throw.

Three pieces of surface:

- **`resume(awaited)`** — awaits, then throws `FirsthandSupersededError` if the
  task has been aborted in the meantime. The task swallows that error: being
  superseded is the mechanism working, not a failure anybody has to handle.
- **`signal`** — for the request, so cancellation reaches the network too.
- **`run(fn)`** — establishes the scope for a stretch of code after an `await`,
  which is where `useContext`, `onCleanup` and `effect` need it.

The task's scope ends when the work ends. Anything meant to outlive it belongs
to the owner above.

### Why `resume` is visible

An `await` cannot be intercepted from userland, so the value coming back is the
only place that can ask whether the world still wants this work. Writing that
place out is a cost, and it buys the property that a reader can see where a run
may stop — the same trade `snapshot()` makes for a read that is taken once on
purpose. A compiler pass could rewrite `await` inside a task body and remove the
ceremony; that is a later, optional convenience, and deliberately not what
correctness rests on.

### Why the scope is detached

`clearScope` disposes children **before** it runs its own cleanups. A task scope
sitting in the parent's child list would therefore have its own cleanups run
before the cleanup that aborts it, and they would observe an `AbortSignal` that
still read as live — exactly backwards for code whose job is to react to
cancellation. `createDetachedOwner` gives a scope that inherits context and the
error-boundary chain from its parent but is not in its child list, which puts
the ordering back in `task`'s hands. `task` disposes it on both of its paths, so
nothing is leaked by the detachment.

## Consequences

- An asynchronous continuation can no longer outlive its scope and commit. The
  `data` package's hand-written guards become one shared rule, and that refactor
  removes code rather than adding it.
- Errors from a task reach the nearest `catchError` above it, which is where an
  error from an effect would have gone.
- `task` is an optional `core` export, and an application that never imports it
  pays nothing for it. That is measured rather than assumed, and the mechanism
  is worth writing down because it is easy to break by accident.

  `scripts/build.mjs` measures the runtime budget against an entry that is only
  `packages/dom/src/index.js` plus `internal.js`. `dom/src/index.ts` re-exports
  a **named list** from `core` — `signal`, `computed`, `effect`, `batch`,
  `untrack`, `onCleanup`, `createRoot`, `catchError`, `runWithOwner`,
  `createContext`, `provide`, `useContext` and the error classes. `task` and
  `FirsthandSupersededError` are deliberately not on it, so nothing the budget
  entry can reach pulls them in, and `createDetachedOwner` goes with them
  because `task` is its only caller.

  Measured with the build's own configuration on 2026-09-22:

  | entry                                          | minified | gzip    | `task` present |
  | ---------------------------------------------- | -------- | ------- | -------------- |
  | budget entry (`dom` index + internal)          | 20 737 B | 7 667 B | no             |
  | an app importing `component`/`signal`/`render` | 11 644 B | 4 503 B | no             |
  | the same app, plus `task`                      | 14 254 B | 4 983 B | yes            |

  So an application that asks for `task` pays about 480 B gzip for it, and one
  that does not pays nothing. The budget entry is unmoved by this work: it
  measured 7 673 B on the commit this branched from and 7 667 B with everything
  here applied, which is the tree-shaking doing exactly what the named
  re-export list promises. `@firsthandjs/core` measured on its own does grow,
  by 323 B, because its own entry point exports everything it has — that figure
  is in the reference table and is not the runtime budget.

  **Adding `task` to `dom`'s re-export list would change that**, because the
  budget entry would then reach it and the figure would become an
  everything-imported one, the way the render-function and keyed-view raises
  already are in that file's comments. It is not on the list on purpose: `core`
  is where a lifetime primitive belongs, and putting it on `dom`'s surface would
  place it in every application's import namespace for no gain. A cheap way to
  keep this honest is to grep a production build for the string
  `was superseded` — the one literal in this work that survives minification.

- **Not solved here:** the general diagnostic for a late write. Reporting _any_
  orphaned write needs each signal to know its owner, and taking one at creation
  would defeat `deferOwner`, which exists because most server-rendered
  components make nothing. Inside a task the problem does not arise, because
  `resume` stops the run before the write. Outside one it remains invisible, and
  wants its own decision.
