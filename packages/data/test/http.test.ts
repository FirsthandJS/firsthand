/**
 * `json()`: the platform, with three things done for you.
 *
 * What is asserted here is mostly the boundary — that it labels the one body
 * the platform will not label, and leaves alone the ones it will.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FirsthandHttpError, json } from '@firsthandjs/data';

const context = { signal: new AbortController().signal };
const original = globalThis.fetch;

function capture(body = '{}', status = 200): { seen: Request[]; inits: RequestInit[] } {
  const seen: Request[] = [];
  const inits: RequestInit[] = [];
  globalThis.fetch = ((input: string, init: RequestInit) => {
    inits.push(init);
    seen.push(new Request(`https://test.invalid${input}`, init));
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

    await json('/api/notes', { method: 'DELETE', headers: { 'x-trace': 'abc' } })(context);

    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.headers.get('x-trace')).toBe('abc');
  });

  it('labels a JSON body, which the platform would call text/plain', async () => {
    const { seen } = capture();

    await json('/api/notes', { method: 'POST', json: { title: 'Hello' } })(context);

    expect(seen[0]?.headers.get('content-type')).toBe('application/json');
    await expect(seen[0]?.text()).resolves.toBe('{"title":"Hello"}');
  });

  it('keeps a content type the caller chose', async () => {
    const { seen } = capture();

    await json('/api/notes', {
      method: 'PATCH',
      json: { title: 'Hello' },
      headers: { 'content-type': 'application/merge-patch+json' },
    })(context);

    expect(seen[0]?.headers.get('content-type')).toBe('application/merge-patch+json');
  });

  it('leaves a FormData body alone, boundary and all', async () => {
    const { seen } = capture();
    const form = new FormData();
    form.append('file', 'contents');

    await json('/api/files', { method: 'POST', body: form })(context);

    expect(seen[0]?.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('leaves URL-encoded form data alone too', async () => {
    const { seen } = capture();

    await json('/api/session', {
      method: 'POST',
      body: new URLSearchParams({ email: 'a@b.c' }),
    })(context);

    expect(seen[0]?.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
  });

  it('is given the abort signal the resource handed over, not a new one', async () => {
    const { inits } = capture();
    const controller = new AbortController();

    await json('/api/notes')({ signal: controller.signal });

    expect(inits[0]?.signal).toBe(controller.signal);
  });
});

describe('the response', () => {
  it('parses the body', async () => {
    capture('{"id":7}');

    await expect(json<{ id: number }>('/api/notes/7')(context)).resolves.toEqual({ id: 7 });
  });

  it('treats an empty body as an answer rather than a parse error', async () => {
    capture('', 204);

    await expect(json('/api/notes/7', { method: 'DELETE' })(context)).resolves.toBeUndefined();
  });

  it('throws the status, with whatever the server said', async () => {
    capture('{"message":"gone"}', 404);

    const failure = json('/api/notes/7')(context);

    await expect(failure).rejects.toBeInstanceOf(FirsthandHttpError);
    await expect(failure).rejects.toMatchObject({ status: 404, body: { message: 'gone' } });
  });
});
