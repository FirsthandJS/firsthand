# Mutation testing

100 % coverage says every line ran. It does not say a test would have noticed if
the line were wrong. Mutation testing asks the second question: change the code
in a small, plausible way and see whether the suite fails.

```bash
npm run test:mutation          # Stryker over the reactive core
```

Scope: `packages/core/src` — the reactive graph, the owner tree, context and the
public primitives. That is where a silent defect is most expensive, hardest to
notice in review, and least likely to show up as a visible bug until much later.
The DOM layer and the compiler are covered by behavioural tests whose assertions
are about observable output, where a surviving mutant is usually an equivalent
one.

## Current result

| File           | Mutation score |
| -------------- | -------------: |
| `signal.ts`    |          100 % |
| `computed.ts`  |          100 % |
| `lifecycle.ts` |          100 % |
| `context.ts`   |         94.9 % |
| `core.ts`      |         93.9 % |
| `effect.ts`    |         84.2 % |
| **total**      |    **93.95 %** |

CI fails below 88 %. The threshold has headroom on purpose: a mutant that times
out counts as killed, and how many time out depends on how busy the machine is,
so the same code has scored between about 90.5 % and 94.0 % from run to run. A
gate set to the best observed score would fail on an unlucky afternoon and
teach everyone to ignore it.

The report lands in `reports/mutation/index.html`.

## What it found

The first run scored 88.6 % with 58 survivors, and reading them was worth more
than the number. Five were real gaps — code that could be deleted or inverted
without a single test noticing:

- **`disposeCell` unlinked its sources but not its subscribers.** The tests
  asserted that a disposed computed stops listening; none asserted that the
  effect which was listening to _it_ also lets go. Removing that loop survived.
- **An effect's own disposer could stop disposing its scope** and nothing
  failed: every existing test disposed through the owner tree instead.
- **`catchError` and `runWithOwner` could stop restoring the current scope.**
  Both had tests for what they return and none for what they leave behind.
- **Disposing the same child twice** was only tested on a scope with no
  siblings, so corrupting the parent's child list went unnoticed.
- **The development warnings** were asserted to fire, never asserted not to.

Each became a test in `packages/core/test/mutation-gaps.test.ts`, which took the
score to 91.3 % and `lifecycle.ts` to 100 %. None of them were found by 100 %
line coverage, which the suite already had — which is the whole argument for
running this.

`core.ts` later moved from 91.0 % to 93.5 % for a reason worth recording: the
regression tests for the pull-order defect (see the risk register) killed
mutants that nothing had been exercising. The defect itself was **not** found by
mutation testing, and could not have been — a mutation score asks whether a
test would notice a changed line, and that bug needed a _shape_ of graph that
no test had built. Tests written for a real defect tend to kill mutants as a
side effect; mutants do not tend to find real defects of that kind.

## Why the number is not 100 %, honestly

A mutation score of 100 % is not the goal, and chasing it produces worse tests
than leaving it alone. Most of what survives here falls into three groups:

1. **Equivalent mutants.** Flipping a `>` to a `>=` in the flush step limit, or
   removing a `flags & QUEUED` short-circuit that only avoids a duplicate queue
   entry, produces a program with identical observable behaviour. The only way
   to "kill" these is to assert on internals that are not part of any contract,
   which makes the suite brittle without making it stronger.

2. **Optimisations, which are by definition unobservable.** The link-reuse fast
   paths in `link()` exist to avoid allocating; removing them leaves the graph
   correct and slower. The structural tests in `graph.test.ts` catch the ones
   that change the shape of the dependency list; the rest are a job for the
   benchmark, not for a unit test.

3. **Diagnostics.** Mutating the text of a development warning survives, and
   should.

Where a surviving mutant is _not_ in one of those groups, it is a missing test,
and the fix is a test rather than a threshold change.

## Reading the report

Open `reports/mutation/index.html` and sort by "Survived". For each one, ask:
would an application behave differently? If yes, write the test that proves it.
If no, it is equivalent — leave it, and do not add an assertion about internals
just to turn the number green.
