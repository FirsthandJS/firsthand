# Examples

```bash
npm install            # from the repository root
npm run build          # build the packages the examples import
cd examples && npm run dev
```

| Example                           | What it shows                                                            |
| --------------------------------- | ------------------------------------------------------------------------ |
| [`counter`](counter/)             | The whole model in twenty lines: setup runs once, three DOM parts update |
| [`todo`](todo/)                   | Keyed rows, derived state, a filter, and rows that survive updates       |
| [`context`](context/)             | A theme read ten levels deep, changed without walking the tree           |
| [`portal`](portal/)               | A modal in `document.body` that keeps its context and its disposal       |
| [`router`](router/)               | Nested routes, a parameter page updated in place, a chunk on demand      |
| [`query`](query/)                 | Tag-based caching: one mutation, two queries, a visible request log      |
| [`massive-table`](massive-table/) | 100 000 rows, with the same timing method the benchmark uses             |

Each example is an ordinary Vite application using the published compiler
plugin. There is nothing example-specific in the framework.

`ssr` is the one exception to "run them all with one command": it needs a
server, so it is its own project with its own `package.json`. See
[its README](ssr/README.md).
