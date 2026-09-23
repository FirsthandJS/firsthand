# Architectural Decision Records

Every decision with performance or semantic consequences is recorded here using
the same sections: Problem, Constraints, Options considered, Chosen design,
Performance implications, Memory implications, DX implications, Rejected
alternatives. "Because it is simpler" is not an accepted justification where
performance or semantics are affected.

| ADR                                                              | Title                                                          | Status                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| [0001](0001-fine-grained-reactivity-instead-of-rerender.md)      | Fine-grained reactivity instead of component re-render         | accepted                                            |
| [0002](0002-linked-list-dependency-edges.md)                     | Doubly-linked reusable edges instead of Sets or arrays         | accepted                                            |
| [0003](0003-hostless-components-with-optional-custom-element.md) | Hostless components by default, custom element host opt-in     | accepted, re-validate in Phase 10                   |
| [0004](0004-component-identity-without-name-strings.md)          | Component identity from symbols and build ids                  | accepted                                            |
| [0005](0005-reactive-props-via-accessors.md)                     | Reactive props via accessor descriptors                        | accepted                                            |
| [0006](0006-synchronous-scheduling.md)                           | Synchronous flush with explicit batching                       | accepted                                            |
| [0007](0007-light-dom-default.md)                                | Light DOM by default, Shadow DOM opt-in                        | accepted, re-validate in Phase 10                   |
| [0008](0008-owner-tree-for-context-and-portals.md)               | A logical owner tree, independent of the DOM                   | accepted                                            |
| [0009](0009-compiler-templates-and-thunks.md)                    | Cloned templates plus thunk-compiled dynamic parts             | accepted                                            |
| [0010](0010-list-reconciliation-decided-by-measurement.md)       | Keyed list reconciliation chosen by benchmark                  | accepted (LIS, by measurement)                      |
| [0011](0011-memory-management-and-leak-testing.md)               | Eager unlinking, and leak tests that can fail                  | accepted                                            |
| [0012](0012-native-events-with-delegation.md)                    | Native events with delegation, no synthetic events             | accepted                                            |
| [0013](0013-routes-as-data-and-on-demand-chunks.md)              | Routes as data, and route code loaded on demand                | accepted                                            |
| [0014](0014-tag-based-cache-invalidation.md)                     | Invalidation by tags, not by cache keys                        | superseded by [0022](0022-resources-not-a-cache.md) |
| [0015](0015-styling-with-custom-properties.md)                   | A prop change is a custom property, not a new class            | accepted                                            |
| [0016](0016-interop-with-component-libraries.md)                 | Web components first, and a React bridge for the rest          | accepted                                            |
| [0017](0017-foreign-element-types.md)                            | Element types this framework does not own                      | accepted                                            |
| [0018](0018-deep-reactivity-as-its-own-package.md)               | Deep reactivity beside signals, not inside them                | accepted                                            |
| [0019](0019-strict-reactivity.md)                                | Strict reactivity, paid for at build time                      | accepted                                            |
| [0020](0020-devtools-without-a-runtime-cost.md)                  | Devtools that production does not pay for                      | accepted                                            |
| [0021](0021-localisation-as-an-adapter.md)                       | Localisation as an adapter, not a library                      | accepted                                            |
| [0022](0022-resources-not-a-cache.md)                            | Resources and invalidation, with caching left to the transport | accepted                                            |
| [0023](0023-one-cache-at-the-transport-edge.md)                  | One cache, at the transport edge                               | accepted                                            |
| [0024](0024-an-invalidation-outlives-its-reader.md)              | An invalidation outlives the resource that was watching        | accepted                                            |
| [0025](0025-tags-as-cache-metadata.md)                           | Tags as cache metadata, never as cache identity                | accepted                                            |
| [0026](0026-a-function-is-a-reactive-scope.md)                   | A function is a reactive scope, one level up                   | accepted                                            |
| [0027](0027-server-rendering-and-hydration.md)                   | Server rendering as a second compiler target, hydration adopts | accepted                                            |
| [0028](0028-async-work-has-an-owner.md)                          | Async work has an owner, and a task is the adapter             | accepted                                            |
| [0029](0029-a-mutation-is-not-a-read.md)                         | A mutation is not a read, so it does not abort by default      | accepted                                            |
