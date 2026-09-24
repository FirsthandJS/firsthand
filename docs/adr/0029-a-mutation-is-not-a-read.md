# ADR-0029: A mutation is not a read, so it does not abort by default

**Status:** accepted · 2026-09-22 · extends
[ADR-0022](0022-resources-not-a-cache.md)

## Problem

`useAction` began every run by aborting the one before it:

```ts
controller?.abort();
```

For a resource that is right, and `useResource` does the same thing on purpose:
a newer read supersedes an older one, and an abandoned read costs nothing but
the answer nobody wanted.

A mutation is the opposite, for a reason that is not a matter of taste:
**aborting a request does not undo what it did.** `AbortController` stops the
client from listening. It does not stop the server from having received the
body, parsed it and committed it. Two quick clicks on "add to cart" therefore
produced one visible result and two rows.

Worse, the failure was silent by construction. The aborted run returned
`undefined` through the same path a disposed component takes, so a caller could
not distinguish "the mutation did not happen" from "the mutation happened and
you will not be told". There were no tests for two overlapping `run()` calls,
which is consistent with nobody having decided this — the policy was inherited
from the resource path rather than chosen for the action path.

## Constraints

- **The unsafe policy must be asked for, not assumed.** Whatever the default
  is, it may not be the one that can lose a write.
- **No policy engine.** Four named behaviours that cover what applications
  actually do, not a scheduler with hooks.
- **`running` must stay honest** under a policy that allows more than one run
  at a time.

## Decision

`useAction` takes a `concurrency` option. It defaults to `queue`.

| policy   | what a second `run()` does while the first is out           |
| -------- | ----------------------------------------------------------- |
| `queue`  | waits, then runs. Order preserved. **Default.**             |
| `switch` | aborts the one in flight. The old behaviour, now asked for. |
| `drop`   | returns the promise of the run already going.               |
| `all`    | runs concurrently; each settles on its own.                 |

`queue` is the default because it is the only one of the four that can neither
lose a write nor reorder two of them. It costs latency when a user is faster
than the server, which is the right thing to pay: a slow second save is a worse
experience than a lost first one, and it is a recoverable one.

`switch` remains exactly right for an idempotent mutation whose later input
supersedes its earlier one — an autosaved draft, a slider committed on change.
It is now a sentence at the call site instead of a property of the framework.

`drop` is the double-clicked button, and it hands both callers the same promise
so that neither has to special-case having been ignored.

`all` is for mutations that genuinely accumulate and do not conflict.

### `running` counts, rather than latching

`succeed` and `fail` each clear `loading` for their own run, which is correct
when at most one is out and wrong under `all`. The action therefore keeps a
count of outstanding runs and reports `running` from it, in the one place that
knows. A quick run finishing while a slow one is still out no longer reports the
action as idle.

**Amended (0.12.0).** The count was of runs actually out, which left two gaps
that the first version of this ADR did not see.

A run queued behind another was not counted, and `succeed` cleared the flag
before the count could correct it — two writes, both observed — so `running`
went false between two queued runs and a spinner blinked in the gap. Two clicks
the person made as one gesture are one wait, so a queued run now counts from
`run()`, and a run reports its departure in the same batch it settles in.

And `invalidates()` was recorded on the action rather than on the run, and
cleared as each run started: under `all`, a run that declared its tags and kept
working lost them to whichever run started next. Each run now carries its own
list. Both are the same oversight as the one this section already describes —
state that is per-run kept per-action — which is worth saying plainly, because
it is the third time that shape has produced a bug here.

## Consequences

- The default behaviour of `useAction` changed. The test that pinned the old
  behaviour still exists and still passes; it now names `concurrency: 'switch'`,
  which is what it was always testing.
- An action's `run` is no longer a single `async` function: the policy decides
  what to chain onto, and the run itself is a private `once`. It never rejects,
  so chaining needs no `catch` and one failed run does not stop the queue behind
  it.
- A queued run checks `disposed` when it starts rather than when it was asked
  for, so a run still waiting behind another when the component goes away never
  begins.
- This is the policy question only. Committing several invalidated resources as
  one visible change is a different problem, deliberately not solved here: it
  needs `entry.run` split into a fetch phase and a commit phase, and that split
  belongs on top of [ADR-0028](0028-async-work-has-an-owner.md) rather than
  beside it.
