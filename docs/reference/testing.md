# @firsthandjs/testing

[Reference index](../README.md#reference) · a development dependency; nothing
here ships

Mounting, cleanup and leak probes. Guide: [Testing](../guide/12-testing.md).

---

## mount

```ts
function mount(view: () => View, parent?: ParentNode): Mounted;

interface Mounted {
  readonly container: HTMLElement;
  /** Disposes the view and removes its container. Idempotent. */
  readonly unmount: Dispose;
  text(): string;
  /** `querySelector` that throws instead of returning null. */
  get<E extends Element = HTMLElement>(selector: string): E;
  /** `querySelectorAll` as a real array. */
  all<E extends Element = HTMLElement>(selector: string): E[];
}
```

```ts
const view = mount(() => <Counter start={2} />);
view.get<HTMLButtonElement>('button').click();
expect(view.text()).toBe('3'); // no await: writes are synchronous
```

Rendered into a container **attached** to the document, not a detached tree:
layout, focus, events and `:hover` all behave differently detached, and a test
that only passes detached is a test of something else.

`get` throws rather than returning `null` so that a selector typo fails as a
selector typo, and so no call site needs a non-null assertion.

## cleanup

```ts
function cleanup(): void;
function autoCleanup(): boolean;
```

`cleanup()` unmounts everything `mount` created. `autoCleanup()` registers it
with the surrounding test framework's `afterEach`, if there is one, and returns
whether it found one — call it once in a setup file:

```ts
// vitest.setup.ts
import { autoCleanup } from '@firsthandjs/testing';
autoCleanup();
```

A test that forgets to unmount then cannot leak into the next one, which is the
failure mode that makes a suite mysteriously order-dependent.

## withRoot

```ts
function withRoot<T>(fn: () => T): { value: T; dispose: Dispose };
```

Runs `fn` in its own reactive root, for testing reactivity with no DOM at all —
signals, computeds, effects and context work in plain Node, because the core
has no DOM dependency.

## subscriberCount

```ts
function subscriberCount(source: object): number;
```

How many live subscribers a signal or computed has. This is the number a leak
test wants: after disposing whatever was watching it, a source that still has
subscribers is still reachable from the graph, and nothing it references can be
collected.

```ts
const view = mount(() => <Thing value={count} />);
view.unmount();
expect(subscriberCount(count)).toBe(0);
```

It reads the graph rather than guessing from the heap, so it is deterministic
in every engine.

## tick

```ts
function tick(ms?: number): Promise<void>;
```

Waits for pending microtasks and, optionally, a timer. Firsthand updates the DOM
synchronously ([ADR-0006](../adr/0006-synchronous-scheduling.md)), so this is **not**
needed after a signal write. It is here for the ordinary reason any test needs
it: an `await` in application code, a `fetch`, a `queueMicrotask`.
