/**
 * The Axios client, against a stub of the one method it touches.
 *
 * A stub rather than Axios itself, because that is the claim this package
 * makes: it knows one method name and nothing else, so there is nothing a
 * version bump could break that a stub would not also catch.
 */
import { describe, expect, it } from 'vitest';
import { signal } from '@firsthandjs/core';
import { createCacheClient, type DataRequest } from '@firsthandjs/data';
import { createAxiosClient, type AxiosLike } from '@firsthandjs/data-axios';

const ask = (force = false): DataRequest => ({
  signal: new AbortController().signal,
  force,
});

/** Records what the instance was asked for, and answers. */
function stub(answer: unknown = { id: 5 }, fail?: Error) {
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    instance: {
      request: (config: Record<string, unknown>) => {
        seen.push(config);
        return fail === undefined ? Promise.resolve({ data: answer }) : Promise.reject(fail);
      },
    } as unknown as AxiosLike,
  };
}

describe('createAxiosClient', () => {
  it('unwraps `data`, which is the only thing a resource wants', async () => {
    const { instance } = stub();

    await expect(
      createAxiosClient(instance).get<{ id: number }>('/users/5')(ask()),
    ).resolves.toEqual({ id: 5 });
  });

  it('wires the abort signal, which is the mistake it exists to prevent', async () => {
    const { seen, instance } = stub();
    const controller = new AbortController();

    await createAxiosClient(instance).get('/users/5')({ signal: controller.signal, force: false });

    expect(seen[0]?.['signal']).toBe(controller.signal);
    expect(seen[0]?.['method']).toBe('get');
  });

  it('sends each verb with its method and its data', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance);

    await api.post('/users', { name: 'Ada' })(ask());
    await api.put('/users/5', { name: 'Ada' })(ask());
    await api.patch('/users/5', { name: 'Ada' })(ask());
    await api.remove('/users/5')(ask());
    await api.request({ url: '/users', method: 'head' })(ask());

    expect(seen.map((config) => config['method'])).toEqual([
      'post',
      'put',
      'patch',
      'delete',
      'head',
    ]);
    expect(seen[0]?.['data']).toEqual({ name: 'Ada' });
  });

  it('reads headers per request, so a token that changes is the current one', async () => {
    const { seen, instance } = stub();
    const token = signal('first');
    const api = createAxiosClient(instance, {
      headers: () => ({ authorization: `Bearer ${token.value}` }),
    });

    await api.get('/me')(ask());
    token.value = 'second';
    await api.get('/me', { headers: { 'x-trace': 'abc' } })(ask());

    expect(seen[0]?.['headers']).toEqual({ authorization: 'Bearer first' });
    expect(seen[1]?.['headers']).toEqual({ authorization: 'Bearer second', 'x-trace': 'abc' });
  });

  it('takes static headers and a config for every request', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance, {
      headers: { 'x-app': 'notes' },
      config: { timeout: 5000 },
    });

    await api.get('/me')(ask());

    expect(seen[0]?.['headers']).toEqual({ 'x-app': 'notes' });
    expect(seen[0]?.['timeout']).toBe(5000);
  });

  it('caches a read when it was given a cache, and lets `force` through it', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance, { cache: { ttl: 10_000 } });

    await api.get('/users/5')(ask());
    await api.get('/users/5')(ask());
    expect(seen).toHaveLength(1);

    await api.get('/users/5')(ask(true));
    expect(seen).toHaveLength(2);
  });

  it('never caches a write', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance, { cache: { ttl: 10_000 } });

    await api.post('/users', { name: 'Ada' })(ask());
    await api.post('/users', { name: 'Ada' })(ask());

    expect(seen).toHaveLength(2);
  });

  it('keys a cached read by base URL and path', async () => {
    const { instance } = stub();
    const shared = createCacheClient({ ttl: 10_000 });
    const api = createAxiosClient(instance, { cache: shared });

    await api.get('/users/5', { baseURL: 'https://accounts.test' })(ask());

    expect(shared.peek('GET https://accounts.test/users/5')).toEqual({ id: 5 });
  });

  it('makes a variation that keeps what it did not replace, cache included', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance, {
      headers: { 'x-app': 'notes' },
      cache: { ttl: 10_000 },
    });
    const traced = api.with({ config: { timeout: 100 } });

    await traced.get('/me')(ask());

    expect(seen[0]?.['headers']).toEqual({ 'x-app': 'notes' });
    expect(seen[0]?.['timeout']).toBe(100);
    expect(traced.cache).toBe(api.cache);
  });

  it('has no cache unless it was asked for one', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance);

    await api.get('/users/5')(ask());
    await api.get('/users/5')(ask());

    expect(api.cache).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it('fills in what the shortcuts would have, for the general form', async () => {
    const { seen, instance } = stub();
    const api = createAxiosClient(instance, { cache: { ttl: 10_000 } });

    // No method and no path: an instance with a `baseURL` and a client that
    // says nothing more is an ordinary Axios call, and it is a read.
    await api.request({ baseURL: 'https://accounts.test' })(ask());
    await api.request({ baseURL: 'https://accounts.test' })(ask());

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['method']).toBeUndefined();
  });

  it('keeps having no cache when a variation adds none', () => {
    const { instance } = stub();
    const plain = createAxiosClient(instance).with({ headers: { 'x-app': 'notes' } });

    expect(plain.cache).toBeUndefined();
  });

  it('lets a failure through, so it lands in `error`', async () => {
    const { instance } = stub(undefined, new Error('timeout'));

    await expect(createAxiosClient(instance).get('/users/5')(ask())).rejects.toThrow('timeout');
  });
});
