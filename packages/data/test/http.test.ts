/**
 * `createFetchClient`: the platform, configured once.
 *
 * What is asserted here is mostly the boundary — that it labels the one body
 * the platform will not label and leaves alone the ones it will, that a token
 * read per request is the current one *and* not a dependency, and that the
 * cache it keeps is one an invalidation can reach through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, effect, signal } from '@firsthandjs/core';
import {
  FirsthandHttpError,
  createCacheClient,
  createFetchClient,
  type DataRequest,
} from '@firsthandjs/data';

const ask = (force = false): DataRequest => ({
  signal: new AbortController().signal,
  force,
});
const original = globalThis.fetch;

function capture(body = '{}', status = 200): { seen: Request[]; inits: RequestInit[] } {
  const seen: Request[] = [];
  const inits: RequestInit[] = [];
  globalThis.fetch = ((input: string, init: RequestInit) => {
    inits.push(init);
    // Only a relative path needs an origin to become a `Request`; an absolute
    // one is what the client sent and must be recorded unchanged.
    seen.push(
      new Request(/^[a-z]+:\/\//i.test(input) ? input : `https://test.invalid${input}`, init),
    );
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { seen, inits };
}

afterEach(() => {
  globalThis.fetch = original;
});

describe('the request', () => {
  it('passes method and headers through, because they belong to the platform', async () => {
    const { seen } = capture();
    const api = createFetchClient();

    await api.remove('/api/notes', { headers: { 'x-trace': 'abc' } })(ask());

    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.headers.get('x-trace')).toBe('abc');
  });

  it('names a JSON body, which is the one the platform gets wrong', async () => {
    const { seen } = capture();

    await createFetchClient().post('/api/notes', { json: { title: 'Hello' } })(ask());

    expect(seen[0]?.headers.get('content-type')).toBe('application/json');
    await expect(seen[0]?.text()).resolves.toBe('{"title":"Hello"}');
  });

  it('leaves a content type the caller set', async () => {
    const { seen } = capture();

    await createFetchClient().post('/api/notes', {
      json: { title: 'Hello' },
      headers: { 'content-type': 'application/merge-patch+json' },
    })(ask());

    expect(seen[0]?.headers.get('content-type')).toBe('application/merge-patch+json');
  });

  it('leaves a FormData body alone, because the platform labels that one', async () => {
    const { seen } = capture();
    const form = new FormData();
    form.set('file', new Blob(['x']), 'x.txt');

    await createFetchClient().post('/api/files', { body: form })(ask());

    // multipart/form-data, with the boundary nothing else could have written.
    expect(seen[0]?.headers.get('content-type')).toContain('multipart/form-data; boundary=');
  });

  it('wires the abort signal through', async () => {
    const { inits } = capture();
    const controller = new AbortController();

    await createFetchClient().get('/api/notes')({ signal: controller.signal, force: false });

    expect(inits[0]?.signal).toBe(controller.signal);
  });
});

describe('the client', () => {
  it('puts the base URL in front of a path, and leaves an absolute URL alone', async () => {
    const { seen } = capture();
    const api = createFetchClient({ baseUrl: '/api/v2' });

    await api.get('/notes')(ask());
    await api.get('https://other.example/notes')(ask());

    expect(seen[0]?.url).toBe('https://test.invalid/api/v2/notes');
    expect(seen[1]?.url).toBe('https://other.example/notes');
  });

  it('applies the init it was configured with, and lets a call override it', async () => {
    const { inits } = capture();
    const api = createFetchClient({ init: { credentials: 'include', mode: 'cors' } });

    await api.get('/a')(ask());
    await api.get('/b', { mode: 'same-origin' })(ask());

    expect(inits[0]?.credentials).toBe('include');
    expect(inits[1]?.mode).toBe('same-origin');
    expect(inits[1]?.credentials).toBe('include');
  });

  it('reads headers per request, so a token that changes is the current one', async () => {
    const { seen } = capture();
    const token = signal('first');
    const api = createFetchClient({
      headers: () => ({ authorization: `Bearer ${token.value}` }),
    });

    await api.get('/a')(ask());
    token.value = 'second';
    await api.get('/b')(ask());

    expect(seen[0]?.headers.get('authorization')).toBe('Bearer first');
    expect(seen[1]?.headers.get('authorization')).toBe('Bearer second');
  });

  it('does not make that token a dependency of whoever sent the request', async () => {
    capture();
    const token = signal('first');
    const api = createFetchClient({
      headers: () => ({ authorization: `Bearer ${token.value}` }),
    });
    let runs = 0;

    const stop = createRoot((dispose) => {
      effect(() => {
        runs += 1;
        void api.get('/a')(ask());
      });
      return dispose;
    });
    await Promise.resolve();
    token.value = 'second';

    // The measured bug this prevents: a sign-out writing the token would
    // otherwise re-send every request that had built a header from it.
    expect(runs).toBe(1);
    stop();
  });

  it('merges a call’s headers over the client’s', async () => {
    const { seen } = capture();
    const api = createFetchClient({
      headers: { authorization: 'Bearer shared', 'x-app': 'notes' },
    });

    await api.get('/a', { headers: { authorization: 'Bearer just-this-one' } })(ask());

    expect(seen[0]?.headers.get('authorization')).toBe('Bearer just-this-one');
    expect(seen[0]?.headers.get('x-app')).toBe('notes');
  });

  it('wraps fetch when it was given one, which is the seam for a 401', async () => {
    capture('{}', 401);
    const captured = globalThis.fetch;
    const seen: number[] = [];
    const api = createFetchClient({
      fetch: async (input, init) => {
        const response = await captured(input, init);
        seen.push(response.status);
        return response;
      },
    });

    await expect(api.get('/api/me')(ask())).rejects.toThrow(FirsthandHttpError);
    expect(seen).toEqual([401]);
  });

  it('makes a variation that keeps what it did not replace, cache included', async () => {
    const { seen } = capture();
    const api = createFetchClient({
      baseUrl: '/api',
      headers: { 'x-app': 'notes' },
      cache: { ttl: 1000 },
    });
    const admin = api.with({ baseUrl: '/admin' });

    await admin.get('/users')(ask());

    expect(seen[0]?.url).toBe('https://test.invalid/admin/users');
    expect(seen[0]?.headers.get('x-app')).toBe('notes');
    // One cache, not two: a variation is a variation, not a second
    // application with its own memory.
    expect(admin.cache).toBe(api.cache);
  });

  it('lets a variation replace the cache, or drop it entirely', async () => {
    const { seen } = capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });
    const live = api.with({ cache: false });

    await live.get('/api/now')(ask());
    await live.get('/api/now')(ask());

    expect(live.cache).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it('keeps having no cache when a variation adds none', () => {
    expect(createFetchClient().with({ baseUrl: '/admin' }).cache).toBeUndefined();
  });

  it('takes a cache built outside, so several clients can share one', async () => {
    capture('{"id":1}');
    const shared = createCacheClient({ ttl: 1000 });
    const api = createFetchClient({ cache: shared });

    await api.get('/api/notes/1')(ask());

    expect(shared.peek('GET /api/notes/1')).toEqual({ id: 1 });
  });
});

describe('the answer', () => {
  it('parses the body', async () => {
    capture('{"id":7}');
    await expect(createFetchClient().get<{ id: number }>('/api/notes/7')(ask())).resolves.toEqual({
      id: 7,
    });
  });

  it('treats an empty body as an answer rather than a parse error', async () => {
    capture('', 204);
    await expect(createFetchClient().remove('/api/notes/7')(ask())).resolves.toBeUndefined();
  });

  it('throws a failed status, with the body it came with', async () => {
    capture('{"message":"gone"}', 410);

    const failure = createFetchClient().get('/api/notes/7')(ask());

    await expect(failure).rejects.toThrow(FirsthandHttpError);
    await expect(failure).rejects.toMatchObject({
      status: 410,
      body: { message: 'gone' },
    });
  });
});

describe('the cache', () => {
  it('is not there unless it was asked for', async () => {
    const { seen } = capture();
    const api = createFetchClient();

    await api.get('/api/notes')(ask());
    await api.get('/api/notes')(ask());

    expect(api.cache).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it('serves a second read of the same URL within its lifetime', async () => {
    const { seen } = capture('{"id":1}');
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await api.get('/api/notes/1')(ask());
    await expect(api.get<{ id: number }>('/api/notes/1')(ask())).resolves.toEqual({ id: 1 });

    expect(seen).toHaveLength(1);
  });

  it('is reached through by an invalidation', async () => {
    const { seen } = capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await api.get('/api/notes/1')(ask());
    await api.get('/api/notes/1')(ask(true));

    // Without this, invalidating a resource would be answered out of the very
    // cache the invalidation was meant to defeat.
    expect(seen).toHaveLength(2);
  });

  it('never caches a write, whatever the client was told', async () => {
    const { seen } = capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await api.post('/api/notes', { json: { title: 'a' } })(ask());
    await api.post('/api/notes', { json: { title: 'a' } })(ask());

    expect(seen).toHaveLength(2);
  });

  it('caches a reading POST under the key it was given', async () => {
    const { seen } = capture('{"rows":[]}');
    const api = createFetchClient({ cache: { ttl: 10_000 } });
    const search = api.post('/api/search', { json: { q: 'ada' }, cacheKey: 'search:ada' });

    await search(ask());
    await search(ask());

    expect(seen).toHaveLength(1);
  });

  it('skips the cache for a call that says so', async () => {
    const { seen } = capture();
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await api.get('/api/now', { cacheKey: false })(ask());
    await api.get('/api/now', { cacheKey: false })(ask());

    expect(seen).toHaveLength(2);
  });

  it('shares one request between callers that overlap', async () => {
    const calls = vi.fn();
    globalThis.fetch = ((input: string) => {
      calls(input);
      return new Promise((settle) =>
        setTimeout(() => settle(new Response('{"id":1}')), 5),
      ) as Promise<Response>;
    }) as unknown as typeof fetch;
    const api = createFetchClient({ cache: {} });

    await Promise.all([api.get('/api/notes/1')(ask()), api.get('/api/notes/1')(ask())]);

    // With no lifetime at all: two identical requests overlapping in time is
    // waste rather than staleness, so sharing them is always right.
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('sends the other verbs with their methods', async () => {
    const { seen } = capture();
    const api = createFetchClient();

    await api.put('/a', { json: {} })(ask());
    await api.patch('/b', { json: {} })(ask());
    await api.request('/c', { method: 'OPTIONS' })(ask());

    expect(seen.map((request) => request.method)).toEqual(['PUT', 'PATCH', 'OPTIONS']);
  });
});
