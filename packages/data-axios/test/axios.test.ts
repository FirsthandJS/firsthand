/**
 * The Axios binding, against a stub of the one method it touches.
 */
import { describe, expect, it } from 'vitest';
import { axiosLoader, type AxiosLike } from '@firsthandjs/data-axios';

describe('axiosLoader', () => {
  it('unwraps `data`, which is the only thing a resource wants', async () => {
    const instance = {
      request: () => Promise.resolve({ data: { id: 5 } }),
    } as unknown as AxiosLike;

    await expect(
      axiosLoader(instance)<{ id: number }>({ url: '/users/5' })({
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ id: 5 });
  });

  it('wires the abort signal, which is the mistake it exists to prevent', async () => {
    const seen: Record<string, unknown>[] = [];
    const instance = {
      request: (config: Record<string, unknown>) => {
        seen.push(config);
        return Promise.resolve({ data: undefined });
      },
    } as unknown as AxiosLike;
    const controller = new AbortController();

    await axiosLoader(instance)({ url: '/users/5', method: 'GET' })({ signal: controller.signal });

    expect(seen[0]?.['signal']).toBe(controller.signal);
    expect(seen[0]?.['method']).toBe('GET');
  });

  it('lets a failure through, so it lands in `error`', async () => {
    const instance = {
      request: () => Promise.reject(new Error('timeout')),
    } as unknown as AxiosLike;

    await expect(
      axiosLoader(instance)({ url: '/users/5' })({ signal: new AbortController().signal }),
    ).rejects.toThrow('timeout');
  });
});
