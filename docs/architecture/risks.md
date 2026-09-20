# Technical risk register

Identified before any code was written, each with how it would be detected
rather than merely that it had been "considered". The outcome column is what
happened when it was.

Three of the twelve turned out to be wrong in an interesting way: the element
host is cheaper than feared, delegated events are faster rather than slower,
and the reconciler the design expected to win lost. Two were right and worth
having: 100 % coverage really was hiding untested code, and the React
comparison really did need a correctness check in front of it.

The last open one, R2, is now measured rather than argued: `npm run bench:ic`
reads `.value` two million times per sample from a site that sees only
signals, from a site that sees signals, computeds and effect-subscribed cells,
and from a control site that sees eight unrelated object shapes. The mixed
site costs 1.01x the single-shape site — within noise — and the control costs
28.7x, which is how the measurement shows it could have detected a problem.
The design's claim that one node shape serves every kind of cell is therefore
a measured property, not an intention.

| #   | Risk                                                                                  | Impact if real                                           | How it was checked          | Outcome                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Custom element construction cost dominates mass mount                                 | 100k mount loses to React by a wide margin               | `npm run bench:micro`       | **closed, partly refuted**: an element host costs 1.5x mount time and doubles the node count — real, but it does not dominate. Hostless stays the default; ADR-0003 was corrected.                                                                                                   |
| R2  | `.value` access sites become megamorphic across many signal shapes                    | Every read slows down; the hottest path in the framework | `npm run bench:ic`          | **closed**: measured. A site reading signals, computeds and effect-subscribed cells costs 1.01x a site reading signals alone — no penalty — while the control site, reading eight unrelated shapes, costs 28.7x. One node shape is one node shape as far as the engine is concerned. |
| R3  | Thunk closures per dynamic part add measurable allocation at 100k rows                | Mount time and GC pressure regress                       | `npm run bench:profile`     | **closed**: ~100 bytes per mounted row in total, ~40 bytes across a thousand re-evaluated bindings.                                                                                                                                                                                  |
| R4  | Delegated dispatch is slower than direct listeners at realistic depths                | Input latency regresses versus React                     | `npm run bench:micro`       | **closed, refuted**: delegation is cheaper to register and faster to dispatch at depths 1, 5 and 20.                                                                                                                                                                                 |
| R5  | LIS reconciler's allocations dominate at 100k                                         | Reorder scenarios lose                                   | `npm run bench:reconcilers` | **closed, and the prediction was wrong**: LIS won (1.01 against 1.17 and 1.49 on the latest run) and ships. ADR-0010 had expected the two-ended scan.                                                                                                                                |
| R6  | 6 kB gzip target unreachable with the full feature set                                | A headline goal is missed                                | `npm run build`             | **closed**: 5.88 kB gzip with everything imported; the build fails above 6 kB. Routing and the query cache are separate packages, outside that budget.                                                                                                                               |
| R7  | 100 % branch coverage pushes toward unreachable defensive branches                    | Coverage becomes theatre                                 | `npm run test:mutation`     | **closed, and it was a real risk**: mutation testing found five places where code could be deleted without a test noticing. Score 93.95 %, gated at 88 % — the gate has headroom because timeout classification moves the score about a point between runs on identical code.        |
| R8  | Compiler cannot always prove props destructuring safe                                 | Either silent stale props or false-positive build errors | Compiler test corpus        | **closed by decision**: no rewrite is attempted. Destructuring is a build error naming the property and the live read to use (ADR-0005).                                                                                                                                             |
| R9  | Synchronous flush causes pathological work in write-heavy loops                       | `rapid signal updates` scenario loses badly              | `npm run bench`             | **closed**: both forms are measured and published. Unbatched is 3.7x faster than React's equivalent, batched 2x.                                                                                                                                                                     |
| R10 | Auto-detection of reactivity misfires when a thunk reads a source only on later runs  | Missed updates — the worst failure class                 | Targeted tests              | **closed by construction**: a part with no dependencies cannot be triggered by anything, so there is nothing that could re-read. Only the compiler's literal constant-folding removes a thunk outright.                                                                              |
| R11 | Firefox/WebKit diverge on `adoptedStyleSheets`, `composedPath`, or template semantics | Cross-engine failures late in the project                | `npx playwright test`       | **closed**: the full suite, including the 100 000-row example, passes in Chromium, Firefox and WebKit with no engine-specific code.                                                                                                                                                  |
| R12 | React comparison is unfair in either direction                                        | The central claim becomes worthless                      | the runner's equality phase | **closed, and it earned its keep**: the check rejected three genuine discrepancies before any timing ran.                                                                                                                                                                            |

R10 deserves a note, because it is the only risk whose failure mode is silent.
The runtime's rule is: a dynamic part's thunk is always evaluated inside a
tracking scope. If the first evaluation reads nothing, no effect is retained —
which is only safe because reading nothing means there is nothing that could
change it. A thunk that reads a signal only on a later run cannot exist, because
that later run would have to be triggered by something, and nothing can trigger
a part with zero dependencies. The compiler's constant folding is the only path
that removes a thunk entirely, and it applies to literal expressions only.

That argument is still correct, and a missed update happened anyway — by a
route the register had not imagined. R10 asks whether a part _subscribes_; the
defect was in what happens after it has. When two subscribers depend on one
computed and the first of them reaches it through a second computed, resolving
the first refreshes the shared computed and clears the mark that says "stale".
The second subscriber, resolved afterwards, then looked at a dependency that no
longer claimed to have changed and concluded it was up to date. It silently
stopped updating.

Nothing in the suite had that shape until the router was built, where a page
and its parameters both read the matched-route computed, and a page simply
stopped responding to navigation. 100 % coverage did not catch it — every line
involved was executed — and neither did mutation testing, which only asks
whether a changed line is noticed, not whether an untested _shape_ exists. The
fix is in `refresh` (`shallowPropagate`), the regression tests are in
`packages/core/test/pull-order.test.ts`, and five of the six fail without it.

The lesson worth keeping is about what the register is for: risks are written
from the design one has in mind, and a graph algorithm's dangerous cases are
combinations of subscribers, not lines of code. Building something real on top
of it — a router, in this case — found in an afternoon what a year of unit
tests on the core had not.
