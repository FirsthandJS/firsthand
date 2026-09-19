# @firsthandjs/core

The reactive graph, the owner tree and context. No DOM: this package must load
unchanged in a worker or on a server.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/02-reactivity.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/core.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```ts
import { signal, computed, effect, batch, untrack } from '@firsthandjs/core';

const count = signal(0);
const doubled = computed(() => count.value * 2);

effect(() => console.log(doubled.value)); // logs 0
count.value = 21; // logs 42, synchronously
```

- Writes push _invalidation_; values are pulled lazily on read, which makes
  diamond dependencies glitch-free without a topological sort.
- Dependency edges are reusable doubly-linked objects, so a re-run with stable
  dependencies allocates nothing.
- Everything is owned: disposing a scope unlinks every edge in both directions.

Full documentation: the [repository README](../../README.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md) and [docs/adr](../../docs/adr).

MIT licensed.
