# Firsthand in Storybook

A working Storybook, so that "Firsthand works with Storybook" is something you can
run rather than something this repository asserts.

```bash
cd integrations/storybook
npm install
npm run storybook   # http://localhost:6006
npm test            # builds it and drives four stories in a real browser
```

It is deliberately **not** part of the root workspace: nobody should have to
install Storybook to work on the framework.

## What it takes

Two things, and neither is a Firsthand package.

**1. The stock HTML renderer.** There is no `@storybook/firsthand` and there does
not need to be one: Firsthand components build DOM, and `@storybook/html-vite`
asks a story for DOM.

```ts
// .storybook/main.ts
framework: '@storybook/html-vite',
viteFinal: (config) => ({
  ...config,
  plugins: [...(config.plugins ?? []), firsthand({ packageName: 'firsthand-stories' })],
}),
```

The plugin is `enforce: 'pre'`, so it sees each story's TSX before anything
else and leaves no JSX for the bundler to interpret. If it is _missing_, your
stories go through the runtime JSX fallback instead, where dynamic expressions
have already been evaluated before the runtime sees them: the story renders
once and then never updates, which looks like a framework bug and is not one.

**2. Fifteen lines of glue** ([`firsthand.ts`](firsthand.ts)), which exist only to
run the disposer:

```ts
export function firsthand(view: () => View): HTMLElement {
  for (const [host, dispose] of live) {
    if (!host.isConnected) {
      dispose();
      live.delete(host);
    }
  }
  const host = document.createElement('div');
  live.set(host, render(view, host));
  return host;
}
```

`render` returns a disposer, and a story that has been replaced must run it or
its effects outlive the canvas. Hosts that have left the document are disposed
on the next render, which needs no Storybook API and cannot fall behind one.

Then a story is a story:

```tsx
export default {
  title: 'Components/Counter',
  args: { initial: 0, step: 1 },
  render: (args) => firsthand(() => <Counter initial={args.initial} step={args.step} />),
} satisfies Meta<CounterArgs>;
```

## What the stories cover

| Story                               | Shows                                                               |
| ----------------------------------- | ------------------------------------------------------------------- |
| `Components/Counter`                | A component, args as props, controls, fine-grained updates          |
| `Components/Counter` (Starts High)  | Args reaching a second instance with different values               |
| `Integration/Router`                | `@firsthandjs/router` on a memory history — routes without a server |
| `Integration/Query`                 | `@firsthandjs/query`: fetch, mutate, invalidate, all in the canvas  |
| `GraphQL/Tags from a .graphql file` | The `.graphql` loader in a real Vite build                          |

The last three are the ones worth having. A page that needs a router and a page
that needs a server are usually exactly the pages that cannot be told as a
story; a memory history and an in-memory fetcher make both ordinary.

The GraphQL one is also the only place the `.graphql` loader is exercised by a
real build rather than a unit test. Its stub transport _rejects_ any document
still carrying a `@tag` or `@invalidates` directive, so "the cache's directives
never reach the server" is checked rather than asserted.

## `npm test`

`verify.mjs` builds the static Storybook, checks the five stories are in its
index, serves it, and drives each one in headless Chromium — clicking the
counter, following a router link, running a mutation and waiting for the query
it invalidated to show the new value, and reading the loaded GraphQL document
off the page to confirm its directives were stripped. It exits non-zero if any
of that stops being true.
