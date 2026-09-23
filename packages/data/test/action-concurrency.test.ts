/**
 * What a second `run()` does while the first is still out.
 *
 * Its own file beside `action.test.ts` because it is its own question: not
 * what an action is, but what two of them are (ADR-0029).
 */
import { describe, expect, it } from 'vitest';
import { createRoot, provide } from '@firsthandjs/core';
import { DataContext, createData, useAction, type DataStore } from '@firsthandjs/data';

const settle = (ms = 20): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

function inRoot<T>(body: () => T, store: DataStore = createData()): { value: T; stop: () => void } {
  let value!: T;
  let stop = (): void => {};
  createRoot((dispose) => {
    stop = dispose;
    provide(DataContext, store);
    value = body();
  });
  return { value, stop };
}

/**
 * A mutation is not a read. Aborting a read costs an answer nobody wanted any
 * more; aborting a mutation abandons a request the server may already have
 * carried out, and nothing on this side can tell. So the default serialises,
 * and every other policy is something the call site asked for (ADR-0029).
 */
describe('action concurrency', () => {
  it('runs one at a time by default, in the order they were called', async () => {
    const order: string[] = [];
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        order.push(`start ${input}`);
        await settle(20);
        order.push(`end ${input}`);
        return input;
      }),
    );

    const first = value.run('one');
    const second = value.run('two');

    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
    // The point: the second did not begin until the first had finished, so
    // neither was abandoned and the server saw both, in order.
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two']);
    stop();
  });

  it('keeps the queue moving when a run fails', async () => {
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        await settle(10);
        if (input === 'bad') {
          throw new Error('no');
        }
        return input;
      }),
    );

    const failed = value.run('bad');
    const after = value.run('good');

    await expect(failed).resolves.toBeUndefined();
    await expect(after).resolves.toBe('good');
    expect(value.data.value).toBe('good');
    stop();
  });

  it('hands a second caller the run already going, under drop', async () => {
    let starts = 0;
    const { value, stop } = inRoot(() =>
      useAction(
        async (input: string) => {
          starts++;
          await settle(30);
          return input;
        },
        { concurrency: 'drop' },
      ),
    );

    const first = value.run('one');
    const second = value.run('two');

    // The double-clicked button: one request, and both callers await it.
    expect(second).toBe(first);
    await expect(first).resolves.toBe('one');
    expect(starts).toBe(1);
    stop();
  });

  it('runs them together under all, and reports loading until the last one lands', async () => {
    const { value, stop } = inRoot(() =>
      useAction(
        async (input: { name: string; ms: number }) => {
          await settle(input.ms);
          return input.name;
        },
        { concurrency: 'all' },
      ),
    );

    const slow = value.run({ name: 'slow', ms: 40 });
    const quick = value.run({ name: 'quick', ms: 10 });

    await expect(quick).resolves.toBe('quick');
    // The quick one has settled, but the slow one has not, so the action is
    // still running — this is what a per-run `loading` flag gets wrong.
    expect(value.running.value).toBe(true);

    await expect(slow).resolves.toBe('slow');
    expect(value.running.value).toBe(false);
    stop();
  });

  it('abandons a queued run when the component goes away before it starts', async () => {
    let starts = 0;
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        starts++;
        await settle(30);
        return input;
      }),
    );

    const first = value.run('one');
    const queued = value.run('two');
    stop();

    await expect(first).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();
    // The second never began: it was still behind the first when the scope
    // went away.
    expect(starts).toBe(1);
  });

  it('answers undefined when it is asked to run after its scope is gone', async () => {
    const { value, stop } = inRoot(() => useAction((input: string) => Promise.resolve(input)));

    stop();

    await expect(value.run('too late')).resolves.toBeUndefined();
  });

  it('does not report a failure that arrived after its scope was gone', async () => {
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        await settle(30);
        throw new Error(`failed for ${input}`);
      }),
    );

    const running = value.run('one');
    stop();

    await expect(running).resolves.toBeUndefined();
    // Nobody is left to show it to, and an error signal on a disposed action
    // is a value no one can clear.
    expect(value.error.value).toBeUndefined();
  });
});
