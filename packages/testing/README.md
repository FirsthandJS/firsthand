# @firsthandjs/testing

Mounting, cleanup and leak probes. Deliberately small: Firsthand renders real DOM,
so the DOM is the API — there is no wrapper object to learn and no query
language re-implemented on top of `querySelector`.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/12-testing.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/testing.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```ts
import { afterEach } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

it('counts up', () => {
  const view = mount(() => <Counter initial={0} />);
  view.get<HTMLButtonElement>('button').click();
  expect(view.text()).toBe('1');   // no await: writes are synchronous
});
```

| Export                    | What it is for                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `mount(view, parent?)`    | Renders into a fresh container attached to the document, with `text()`, `get()` and `all()` helpers |
| `cleanup()`               | Unmounts everything still standing                                                                  |
| `autoCleanup()`           | Registers `cleanup` with whatever `afterEach` the environment has                                   |
| `withRoot(fn)`            | A reactive root with no DOM, for testing signals and context in plain Node                          |
| `subscriberCount(source)` | How many live subscribers a signal has — the number a leak test wants                               |
| `tick(ms?)`               | Waits for asynchronous _application_ code. Never needed after a signal write                        |

The container is attached to the document rather than detached: layout, focus,
events and `:hover` all behave differently in a detached tree, and a test that
only passes detached is a test of something else.

Full guide, including Vitest environments and Playwright:
[the testing guide](../../docs/guide/12-testing.md).

MIT licensed.
