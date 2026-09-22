# Testing

[Index](../README.md) · Previous: [Internationalisation](12-internationalisation.md) · Next:
[Devtools](14-devtools.md)

---

Firsthand renders real DOM synchronously. Both of those make tests simpler than
they usually are: there is no wrapper object between the assertion and the
element, and there is nothing to await after a state change.

```ts
view.get<HTMLButtonElement>('button').click();
expect(view.text()).toBe('1'); // no await, no flush, no act()
```

<!-- tests:start -->
<!-- prettier-ignore-start -->
This repository tests itself the way it documents here: 1186 unit and
compiler tests under Vitest, and 102 runs under Playwright across
Chromium, Firefox and WebKit, covering the framework, the router, the query
cache and all eight example applications.
<!-- prettier-ignore-end -->
<!-- tests:end -->

## Vitest

### Setup

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'my-app' })],
  test: {
    environment: 'happy-dom', // or 'jsdom', or Vitest browser mode
    setupFiles: ['./test/setup.ts'],
  },
});
```

```ts
// test/setup.ts
import { autoCleanup } from '@firsthandjs/testing';

autoCleanup(); // registers cleanup with Vitest's afterEach
```

The compiler plugin matters: without it your TSX goes through the runtime JSX
fallback, where a dynamic expression has already been evaluated by the time the
runtime sees it. Tests would then pass on first render and never update, which
looks like a framework bug and is not one.

It is `enforce: 'pre'`, so nothing else needs configuring — it sees each file
before the bundler's TypeScript step and leaves no JSX behind. If you do want
the runtime fallback for some files, that is the case where you set
`esbuild: { jsx: 'automatic', jsxImportSource: '@firsthandjs/jsx-runtime' }`,
which is what this repository does for the tests that deliberately exercise
that path.

### Which environment

| Environment         | Use it when                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`              | Testing signals, computeds, effects and context. The reactive core has no DOM dependency, so it runs in plain Node — use `withRoot` from `@firsthandjs/testing` |
| `happy-dom`         | The default choice for component tests. Fast, and enough DOM for templates, events, classes and styles                                                          |
| `jsdom`             | When you need something happy-dom has not implemented                                                                                                           |
| Vitest browser mode | When layout, real focus or engine-specific behaviour is the point                                                                                               |

This repository uses `node` for the reactive core and `happy-dom` for
everything else, then re-asserts the same behaviour in real engines with
Playwright. A DOM emulation is fast enough to run on every keystroke; it is not
evidence about a browser.

### Writing a test

```tsx
import { describe, expect, it } from 'vitest';
import { mount } from '@firsthandjs/testing';
import { signal } from '@firsthandjs/dom';
import { TodoRow } from '../src/todo-row.js';

describe('TodoRow', () => {
  it('toggles without re-creating the row', () => {
    const todo = signal({ id: 1, title: 'write tests', done: false });
    const view = mount(() => <TodoRow todo={todo.value} />);
    const row = view.get('li');

    todo.value = { ...todo.value, done: true };

    expect(row.className).toBe('done');
    // The same element: it was updated, not replaced.
    expect(view.get('li')).toBe(row);
  });
});
```

The last assertion is the one worth copying. "Did this update or re-render?" is
the question Firsthand's design is about, and node identity answers it directly.

### Asserting that nothing leaked

```ts
import { subscriberCount } from '@firsthandjs/testing';

const shared = signal(0);
const view = mount(() => <Widget />);
expect(subscriberCount(shared)).toBe(1);

view.unmount();
expect(subscriberCount(shared)).toBe(0);
```

This reads the dependency graph rather than the heap, so it is deterministic in
every engine and needs no forced garbage collection.

### Fake timers and async code

`tick()` waits for microtasks and timers. It is never needed after a signal
write — writes reach the DOM before the next statement — only for the ordinary
reasons any test needs it: an `await` in your own code, a `fetch`, a
`queueMicrotask`.

## Playwright

Firsthand needs no adapter. Its output is DOM, so an ordinary end-to-end test
drives it like any other page.

```ts
// playwright.config.ts
export default defineConfig({
  webServer: { command: 'npm run dev', url: 'http://localhost:5173' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
});
```

```ts
test('the counter counts', async ({ page }) => {
  await page.goto('/counter/');
  const button = page.getByRole('button');
  await expect(button).toHaveText('0');
  await button.click();
  await expect(button).toHaveText('1');
});
```

### Asserting that a node survived

Playwright has no node-identity assertion, so tag the element and check the tag
is still there:

```ts
const row = page.locator('li').first();
await row.evaluate((element) => element.setAttribute('data-probe', 'kept'));
await page.getByRole('button', { name: 'toggle' }).click();
await expect(page.locator('li').first()).toHaveAttribute('data-probe', 'kept');
```

The attribute survives only if the row was updated in place. This repository
uses exactly this trick in `tests/browser/examples.spec.ts`.

### Component testing

`@playwright/experimental-ct-*` packages exist per framework and there is none
for Firsthand. It is also not needed: mount into the page yourself.

```ts
await page.goto('about:blank');
await page.addScriptTag({ path: 'dist/my-components.js', type: 'module' });
await page.evaluate(() => globalThis.mountWidget(document.body));
```

This repository does the same, one level up, in
`tests/browser/fixture/app.tsx`: a small page that exposes the actions a test
wants to trigger and a probe object for the counters a DOM assertion cannot
see, such as how often a component function ran.

## Storybook

Firsthand needs no renderer package. `@storybook/html-vite` asks a story for DOM,
and Firsthand components build DOM:

```ts
// .storybook/main.ts
framework: '@storybook/html-vite',
viteFinal: (config) => ({
  ...config,
  plugins: [...(config.plugins ?? []), firsthand({ packageName: 'my-app' })],
}),
```

The plugin matters for the same reason it does under Vitest: without it a story
goes through the runtime JSX fallback, renders once, and then stops updating.

The only glue is disposal, because `render` returns a disposer that a replaced
story must run:

```ts
const live = new Map<HTMLElement, Dispose>();

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

```tsx
export default {
  title: 'Components/Counter',
  args: { initial: 0 },
  render: (args) => firsthand(() => <Counter initial={args.initial} />),
} satisfies Meta<CounterArgs>;
```

Pages that usually cannot be told as stories — one that needs a router, one
that needs a server — can be here: give `Router` a `createMemoryHistory()` and
give a resource whatever loader the story wants.
[`integrations/storybook/`](../../integrations/storybook/) is a working example,
and its `npm test` drives the built stories in a real browser.

## What to test, and what not to

Worth asserting, because they are the properties the design promises:

- a component function runs **once** per instance, whatever its state does;
- an update changes the parts that read the value and leaves the rest's nodes
  identical;
- keyed rows keep their elements across a reorder;
- disposal leaves no subscribers and no DOM.

Not worth asserting: that a signal holds what you put in it, or that `computed`
computes. Those are the framework's tests, and this repository already runs
them at 100 % coverage with mutation testing on top.

---

Next: [Devtools](14-devtools.md).
