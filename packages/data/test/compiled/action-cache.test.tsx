/**
 * What an action is allowed to do to the cache: nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, provide, render } from '@firsthandjs/dom';
import {
  DataContext,
  createData,
  createFetchClient,
  useAction,
  useResource,
} from '@firsthandjs/data';

const original = globalThis.fetch;
let served = 0;

afterEach(() => {
  globalThis.fetch = original;
  document.body.innerHTML = '';
});

function capture(): void {
  served = 0;
  globalThis.fetch = (() => {
    served += 1;
    return Promise.resolve(new Response(JSON.stringify({ served })));
  }) as unknown as typeof fetch;
}

describe('an action and the cache', () => {
  it('does not leave its answer in the cache for a resource to find', async () => {
    capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });
    let ran: (() => Promise<unknown>) | undefined;

    const Host = component(() => {
      provide(DataContext, createData());
      // A GET that does something: a "recalculate" endpoint, which is how
      // plenty of real APIs are shaped.
      const recalculate = useAction((_: undefined, { request }) =>
        api.get<{ served: number }>('/api/report')(request),
      );
      ran = () => recalculate.run(undefined);
      return null;
    });
    render(() => <Host />, document.body);
    await ran?.();
    const duringAction = served;

    // A resource asking for the same URL afterwards must go to the server:
    // what the action got back was an answer to *doing* something, not a
    // representation of anything.
    const Reader = component(() => {
      provide(DataContext, createData());
      useResource(({ request }) => api.get<{ served: number }>('/api/report')(request));
      return null;
    });
    render(() => <Reader />, document.body);
    await new Promise((wake) => setTimeout(wake, 10));

    expect(duringAction).toBe(1);
    expect(served).toBe(2);
  });

  it('is not served from the cache either, even for the same URL', async () => {
    capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });
    let ran: (() => Promise<unknown>) | undefined;

    const Host = component(() => {
      provide(DataContext, createData());
      useResource(({ request }) => api.get<{ served: number }>('/api/report')(request));
      const recalculate = useAction((_: undefined, { request }) =>
        api.get<{ served: number }>('/api/report')(request),
      );
      ran = () => recalculate.run(undefined);
      return null;
    });
    render(() => <Host />, document.body);
    await new Promise((wake) => setTimeout(wake, 10));
    expect(served).toBe(1);

    await ran?.();

    // The resource's answer is two seconds old and the action asks anyway:
    // it is not asking for the current state, it is asking for something to
    // happen.
    expect(served).toBe(2);
  });

  it('does not make two writes into one, however identical they look', async () => {
    let inFlight = 0;
    globalThis.fetch = (() => {
      inFlight += 1;
      return new Promise((settle) =>
        setTimeout(() => settle(new Response('{}')), 10),
      ) as Promise<Response>;
    }) as unknown as typeof fetch;
    const api = createFetchClient({ cache: { ttl: 10_000 } });
    let ran: (() => Promise<unknown>) | undefined;

    const Host = component(() => {
      provide(DataContext, createData());
      const send = useAction((_: undefined, { request }) =>
        // A key on a write is the one way to ask for it to be cached. Even
        // then it is not: two people pressing "send" is two emails.
        api.post('/api/send', { cacheKey: 'send' })(request),
      );
      ran = () => send.run(undefined);
      return null;
    });
    render(() => <Host />, document.body);
    await Promise.all([ran?.(), ran?.()]);

    expect(inFlight).toBe(2);
  });
});
