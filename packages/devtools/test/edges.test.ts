/**
 * The edges of the devtools protocol.
 *
 * Kept apart from the behavioural suite because each of these is about what
 * happens when something is missing — no stack, no label, no live root — and
 * the answer has to be "something useful" rather than a thrown error in a
 * debugging tool.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, provide, signal } from '@firsthandjs/core';
import { attach, cells, detach, inspect, queries, stack, timeline } from '@firsthandjs/devtools';
import { DataContext, createData, tag, useResource } from '@firsthandjs/data';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  detach();
});

/** What devtools ended up calling a cell, read back through the graph walk. */
function nameFor(cell: object): string | undefined {
  const node = document.createElement('div');
  const effect = { flags: 0, v: undefined, deps: { dep: cell, sub: null } };
  hook().running(effect);
  hook().part(node, 'class');
  hook().running(null);
  return inspect(node)[0]?.dependencies[0]?.name;
}

/** The hook as the framework sees it, which is how these reach the fallbacks. */
const hook = (): NonNullable<typeof globalThis.__FIRSTHAND_DEVTOOLS__> =>
  globalThis.__FIRSTHAND_DEVTOOLS__ as NonNullable<typeof globalThis.__FIRSTHAND_DEVTOOLS__>;

/**
 * Replaces the stack of the next `new Error()`.
 *
 * V8 installs `stack` as an own property on each instance, so overriding it on
 * the prototype has no effect — the constructor itself has to be replaced.
 */
function withStack(stack: string | undefined, body: () => void): void {
  const RealError = globalThis.Error;
  // `Error.stack` is typed as a string, and the case being pinned here is the
  // engine that does not provide one — so the fake is assembled rather than
  // declared as a subclass.
  class Fake extends RealError {
    constructor() {
      super();
      Object.defineProperty(this, 'stack', { value: stack, configurable: true });
    }
  }
  globalThis.Error = Fake as unknown as ErrorConstructor;
  try {
    body();
  } finally {
    globalThis.Error = RealError;
  }
}

describe('naming when the stack does not help', () => {
  it('falls back when the engine provides no stack at all', () => {
    attach();
    const cell = { flags: 0, v: 1 };
    withStack(undefined, () => {
      hook().label(cell, 'signal', '');
    });
    expect(nameFor(cell)).toBe('unknown');
  });

  it('falls back when every frame belongs to the framework', () => {
    attach();
    const cell = { flags: 0, v: 1 };
    withStack('Error\n    at signal (/packages/core/src/signal.ts:21:3)', () => {
      hook().label(cell, 'signal', '');
    });
    expect(nameFor(cell)).toBe('unknown');
  });

  it('keeps the whole location, so the map can be read back', () => {
    attach();
    const cell = { flags: 0, v: 1 };
    withStack('Error\n    at http://localhost:5173/src/order.ts?v=8f1c:31:7', () => {
      hook().label(cell, 'signal', '');
    });
    // The URL is half the answer: `31:7` is a position in the compiled module,
    // and reading it back to the written line needs the module it came from.
    expect(nameFor(cell)).toBe('http://localhost:5173/src/order.ts?v=8f1c:31:7');
  });

  it('keeps a frame that carries no file position', () => {
    attach();
    const cell = { flags: 0, v: 1 };
    withStack('Error\n    at <anonymous>', () => {
      hook().label(cell, 'signal', '');
    });
    expect(nameFor(cell)).toBe('at <anonymous>');
  });
});

describe('naming when nothing recorded a label', () => {
  it('calls an unlabelled cell what it is', () => {
    attach();
    // Reported as a part's dependency without ever having been labelled, which
    // is what a cell created before `attach()` looks like.
    const source = { flags: 0, v: 7 };
    const derived = { flags: 1, v: 8 };
    const effect = { flags: 0, v: undefined, deps: undefined as unknown };
    const node = document.createElement('div');
    hook().running(effect);
    hook().part(node, 'class');
    hook().running(null);
    (effect as { deps: unknown }).deps = {
      dep: source,
      sub: effect,
      nextDep: { dep: derived, sub: effect, nextDep: undefined },
    };

    const [part] = inspect(node);
    expect(part?.dependencies.map((d) => `${d.kind}:${d.name}`)).toEqual([
      'signal:signal',
      'computed:computed',
    ]);
  });

  it('names a part on a node that has no tag name', () => {
    attach();
    const text = document.createTextNode('x');
    const effect = { flags: 0, v: undefined };
    hook().running(effect);
    hook().part(text, 'data');
    hook().running(null);

    expect(inspect(text)[0]?.name).toBe('#text.data');
    expect(inspect(text)[0]?.kind).toBe('part');
  });

  it('names a part on something that is neither, rather than failing', () => {
    attach();
    const odd = {} as unknown as Node;
    const effect = { flags: 0, v: undefined };
    hook().running(effect);
    hook().part(odd, 'value');
    hook().running(null);

    expect(inspect(odd)[0]?.name).toBe('node.value');
  });
});

describe('writes outside an effect', () => {
  it('ignores a part reported while nothing is running', () => {
    attach();
    const node = document.createElement('div');
    hook().running(null);
    hook().part(node, 'class');

    expect(inspect(node)).toEqual([]);
  });
});

describe('roots that are gone', () => {
  // Without `--expose-gc` a dropped reference cannot be made to disappear on
  // demand, so this is recorded as skipped rather than quietly passing.
  const run = typeof globalThis.gc === 'function' ? it : it.skip;

  run('sweeps a root that has been collected', async () => {
    attach();
    createRoot((stop) => {
      signal(1);
      stop();
    });

    expect(cells()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (globalThis.gc as () => void)();

    // The reference is weak, so the walk drops it on the way past rather than
    // holding a disposed scope alive for the life of the page.
    expect(cells()).toEqual([]);
  });
});

describe('the resource store', () => {
  /** Runs `body` under a store, and disposes it. */
  const inRoot = (body: () => void, store = createData()): (() => void) => {
    let stop = (): void => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(DataContext, store);
      body();
    });
    return stop;
  };

  it('records what the store did, in order, with its tags', async () => {
    attach();
    const store = createData();
    const stop = inRoot(() => {
      useResource(({ tags }) => {
        tags(tag('order', { id: 7 }));
        return Promise.resolve('ok');
      });
    }, store);

    await new Promise((wake) => setTimeout(wake, 20));
    await store.invalidate(tag('order'));
    stop();

    expect(queries().map((e) => e.event)).toEqual(['created', 'invalidated', 'dropped']);
    expect(queries()[1]?.tags).toEqual(['order(id: 7)']);
  });

  it('forgets the log when detached', () => {
    attach();
    const stop = inRoot(() => {
      useResource(() => Promise.resolve(1));
    });
    expect(queries()).toHaveLength(1);

    detach();
    expect(queries()).toEqual([]);
    stop();
  });

  it('keeps the log bounded rather than growing with the session', () => {
    attach();
    const stop = inRoot(() => {
      for (let i = 0; i < 205; i++) {
        useResource(() => Promise.resolve(i));
      }
    });

    // 200 entries, and the oldest are the ones that went.
    expect(queries()).toHaveLength(200);
    stop();
  });
});

describe('a stack with nothing behind it', () => {
  it('is empty for an effect that has no scope', () => {
    attach();
    const node = document.createElement('div');
    // A cell with no `scope`: the shape the core gives a released effect.
    const effect = { flags: 0, v: undefined };
    hook().running(effect);
    hook().part(node, 'class');
    hook().running(null);

    expect(stack(node)).toEqual([]);
  });
});

describe('the call stack of a write', () => {
  it('falls back when the engine gives no stack', () => {
    attach();
    const count = signal(1);
    withStack(undefined, () => {
      count.value = 2;
    });

    expect(timeline()[0]?.stack).toEqual([]);
  });

  it('keeps six frames, not a transcript', () => {
    attach();
    const count = signal(1);
    // V8 collects ten frames by default and the framework's own use some of
    // them, so the budget is raised for the length of this test — otherwise
    // the cut at six is never reached and the assertion proves nothing.
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 50;
    const deep = (left: number): void => {
      if (left === 0) {
        count.value = 2;
        return;
      }
      deep(left - 1);
    };
    deep(10);
    Error.stackTraceLimit = limit;

    expect(timeline()[0]?.stack).toHaveLength(6);
  });
});

describe('frames that say nothing', () => {
  it('skips a blank line in a stack', () => {
    attach();
    const count = signal(1);
    withStack('Error\n   \n    at handleClick (/app/order.ts:12:9)', () => {
      count.value = 2;
    });

    expect(timeline()[0]?.stack).toEqual(['handleClick (/app/order.ts:12:9)']);
  });
});

describe('reading a stack frame', () => {
  it('keeps the frames exactly as the engine gave them', () => {
    attach();
    const count = signal(1);
    withStack(
      [
        'Error',
        '    at handleSave (http://localhost:5173/src/order.ts?v=abc:31:7)',
        '    at http://localhost:5173/src/main.tsx:11:10',
        '    at <anonymous>',
      ].join('\n'),
      () => {
        count.value = 2;
      },
    );

    // Raw, positions in the compiled module and all: resolving them needs the
    // module's map, which the panel reads when it shows them.
    expect(timeline()[0]?.stack).toEqual([
      'handleSave (http://localhost:5173/src/order.ts?v=abc:31:7)',
      'http://localhost:5173/src/main.tsx:11:10',
      '<anonymous>',
    ]);
  });
});
