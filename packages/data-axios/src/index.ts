/**
 * Axios, as loaders for `@firsthandjs/data`.
 *
 * It takes a client you built and touches one method of it. Your interceptors,
 * your base URL, your authentication, your retry — all of that stays where it
 * is, because a helper that owned the configuration would take control of the
 * thing it is supposed to be helping with, and would then have to follow every
 * option Axios adds (ADR-0022).
 *
 * There is no dependency on Axios here, and no peer dependency either: the
 * shape below is declared structurally, so this package has no opinion about
 * which version you run and nothing to follow when that version changes.
 *
 * ```ts
 * import axios from 'axios';
 * import { axiosLoader } from '@firsthandjs/data-axios';
 *
 * const accounts = axiosLoader(axios.create({ baseURL: 'https://accounts.example.com' }));
 *
 * const profile = useResource(({ tags, ...rest }) => {
 *   tags(tag('profile', { id: props.id }));
 *   return accounts<Profile>({ url: `/profiles/${props.id}` })(rest);
 * });
 * ```
 */
import type { LoadContext } from '@firsthandjs/data';

/** The part of an Axios instance this package uses. Nothing else. */
export interface AxiosLike {
  request(config: Record<string, unknown>): Promise<{ data: unknown }>;
}

/** What the returned loader is given: an Axios request config, minus the wiring. */
export type AxiosRequest = Record<string, unknown>;

/**
 * Binds an Axios instance so its requests can be a resource's loader.
 *
 * The abort signal is wired for you — Axios takes the same `signal` the
 * platform does, and forgetting it is the mistake that makes a superseded
 * request finish anyway.
 */
export function axiosLoader(instance: AxiosLike) {
  return <T>(config: AxiosRequest) =>
    async ({ signal }: Pick<LoadContext, 'signal'>): Promise<T> => {
      const response = await instance.request({ ...config, signal });
      return response.data as T;
    };
}
