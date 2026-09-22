# Architecture documentation

The design is documented in three places, and this page says which one answers
which question.

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — how the system is put
  together, section by section.
- [`../adr/`](../adr/) — _why_ each decision was made, what else was considered,
  and what it costs. Every ADR carries the same sections, including the rejected
  alternatives.
- [`risks.md`](risks.md) — the technical risks identified before any code was
  written, each with how it will be detected and what the fallback is.
- [`profiling.md`](profiling.md) — what allocates and where the self time goes,
  measured rather than assumed.
- [`mutation-testing.md`](mutation-testing.md) — what 100 % coverage does not
  tell you, and the five real gaps it found here.
- [`code-rules.md`](code-rules.md) — the SOLID and clean-code rules, each with
  the number a tool checks it against and where that number came from.

## Where each topic lives

| Topic                       | Primary                 | Decision record                                                                                                                                 |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reactive graph              | ARCHITECTURE §2.1–2.2   | [ADR-0001](../adr/0001-fine-grained-reactivity-instead-of-rerender.md), [ADR-0002](../adr/0002-linked-list-dependency-edges.md)                 |
| Scheduling                  | ARCHITECTURE §2.3       | [ADR-0006](../adr/0006-synchronous-scheduling.md)                                                                                               |
| Lifecycle and ownership     | ARCHITECTURE §2.4       | [ADR-0008](../adr/0008-owner-tree-for-context-and-portals.md)                                                                                   |
| Components                  | ARCHITECTURE §3, §3.1   | [ADR-0003](../adr/0003-hostless-components-with-optional-custom-element.md), [ADR-0004](../adr/0004-component-identity-without-name-strings.md) |
| Props                       | ARCHITECTURE §3.2–3.3   | [ADR-0005](../adr/0005-reactive-props-via-accessors.md)                                                                                         |
| DOM parts                   | ARCHITECTURE §4.1       | [ADR-0009](../adr/0009-compiler-templates-and-thunks.md)                                                                                        |
| Events                      | ARCHITECTURE §4.2       | [ADR-0012](../adr/0012-native-events-with-delegation.md)                                                                                        |
| Conditional branches        | ARCHITECTURE §4.3       | — (a branch is an ordinary child part; see below)                                                                                               |
| List reconciliation         | ARCHITECTURE §4.4       | [ADR-0010](../adr/0010-list-reconciliation-decided-by-measurement.md)                                                                           |
| Portal ownership            | ARCHITECTURE §4.5       | [ADR-0008](../adr/0008-owner-tree-for-context-and-portals.md)                                                                                   |
| Context                     | ARCHITECTURE §5         | [ADR-0008](../adr/0008-owner-tree-for-context-and-portals.md)                                                                                   |
| Shadow DOM                  | ARCHITECTURE §6         | [ADR-0007](../adr/0007-light-dom-default.md)                                                                                                    |
| Custom element adapter      | ARCHITECTURE §3.1       | [ADR-0003](../adr/0003-hostless-components-with-optional-custom-element.md)                                                                     |
| Compiler output             | ARCHITECTURE §1.1, §4.1 | [ADR-0009](../adr/0009-compiler-templates-and-thunks.md)                                                                                        |
| Memory management           | ARCHITECTURE §2.4       | [ADR-0011](../adr/0011-memory-management-and-leak-testing.md)                                                                                   |
| Error handling              | ARCHITECTURE §7         | —                                                                                                                                               |
| Known requirement conflicts | ARCHITECTURE §8         | —                                                                                                                                               |

## Conditional rendering has no primitive of its own

This is worth calling out because it is a deliberate absence rather than an
omission. `{show.value ? <A/> : <B/>}` compiles to an ordinary dynamic child
part. The part's effect has its own owner scope, and that scope is cleared and
rebuilt on every run — which is exactly branch semantics: the old branch is
disposed with everything it created, the new one is mounted, and nothing else in
the tree is touched.

Two properties make that work, and both are load-bearing:

1. **Component setup runs untracked.** Without it, a component created inside a
   branch would subscribe the branch to everything its setup happened to read,
   and the whole branch would be rebuilt on unrelated changes.
2. **Nested parts create their own effects.** Reads inside the branch's children
   belong to those children, not to the branch, so only the condition itself
   keeps the branch subscribed.

Adding a `<Show>` component or a `branch()` primitive would have bought a
familiar-looking API and cost a concept. The rule stays the one rule: a part
re-evaluates when something it read changes.
