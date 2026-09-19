/**
 * `useQuery` and `useMutation`.
 *
 * Both take their inputs as thunks, because a component body runs once: the
 * query a component watches is `() => ({ tags: [tag('user', { id: props.id })],
 * … })`, re-evaluated when `props.id` changes, which moves the subscription to
 * the entry for the new id. Nothing re-renders; the cells the view reads simply
 * start reporting the other entry.
 */
import {
  computed,
  createContext,
  effect,
  signal,
  untrack,
  useContext,
  type ReadonlyCell,
} from '@firsthandjs/core';
import {
  type LoadOptions,
  type QueryClient,
  type QueryDefinition,
  type QueryResult,
  type QueryStatus,
  type RequestContext,
  type Variables,
} from './client.js';
import type { Tag } from './tags.js';

export const QueryClientContext = createContext<QueryClient>();

/** The client provided above this component. */
export function useQueryClient(): QueryClient {
  return useContext(QueryClientContext).value;
}

export interface UseQueryOptions {
  /**
   * Do not fetch. Useful while a variable the query needs is still missing —
   * the entry exists and reports `idle`, and the fetch happens as soon as
   * this turns true.
   */
  readonly enabled?: boolean;
}

/**
 * Watches a query.
 *
 * The returned cells belong to the cache entry, not to this component: another
 * component asking for the same tags reads the very same cells, so one refetch
 * updates both. Leaving the component releases the entry, and an entry nobody
 * holds is dropped after the client's `cacheTime`.
 */
export function useQuery<T, V extends Variables = Variables>(
  define: () => QueryDefinition<T, V>,
  options: () => UseQueryOptions = () => ({}),
): QueryResult<T> {
  const client = useQueryClient();
  const entry = computed(() => client.entry(define()));

  effect(() => {
    const current = entry.value;
    const release = client.subscribe(current);
    if (options().enabled !== false) {
      // Respects the cache: this is not a request, it is "make sure there is
      // an answer".
      void client.load(untrack(define));
    }
    return release;
  });

  return {
    data: computed(() => entry.value.data.value),
    error: computed(() => entry.value.error.value),
    status: computed(() => entry.value.status.value),
    fetching: computed(() => entry.value.fetching.value),
    // `force` defaults to true here and to false on the client: asking for a
    // refetch means the network unless you say otherwise, and passing an
    // options object must not quietly change that.
    refetch: (loadOptions?: LoadOptions) =>
      client.load(untrack(define), { force: loadOptions?.force ?? true }),
  };
}

export interface MutationOptions<I, R> {
  readonly mutate: (input: I, context: RequestContext) => Promise<R>;
  /**
   * The tags this mutation makes wrong.
   *
   * Every query carrying a matching tag is invalidated at once — which is the
   * point of tags: a mutation says what it changed, not which queries to
   * re-run, and it does not have to know who is watching.
   */
  readonly invalidates?: readonly Tag[] | ((result: R, input: I) => readonly Tag[]);
  readonly onSuccess?: (result: R, input: I) => void;
  readonly onError?: (error: unknown, input: I) => void;
}

export interface MutationResult<I, R> {
  readonly data: ReadonlyCell<R | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<QueryStatus>;
  readonly fetching: ReadonlyCell<boolean>;
  /**
   * Runs the mutation, then invalidates.
   *
   * Never rejects: a failure is reported through `error` and `status`, and the
   * promise resolves with `undefined`. An `onClick` that forgets to `await`
   * therefore cannot produce an unhandled rejection.
   */
  mutate(input: I): Promise<R | undefined>;
  reset(): void;
}

export function useMutation<I, R>(options: MutationOptions<I, R>): MutationResult<I, R> {
  const client = useQueryClient();
  const data = signal<R | undefined>(undefined);
  const error = signal<unknown>(undefined);
  const status = signal<QueryStatus>('idle');
  const fetching = signal(false);
  let controller: AbortController | null = null;

  const mutate = async (input: I): Promise<R | undefined> => {
    controller?.abort();
    controller = new AbortController();
    status.value = 'pending';
    fetching.value = true;
    try {
      const result = await options.mutate(input, { signal: controller.signal });
      data.value = result;
      error.value = undefined;
      status.value = 'success';
      fetching.value = false;
      const { invalidates } = options;
      if (invalidates !== undefined) {
        await client.invalidate(
          ...(typeof invalidates === 'function' ? invalidates(result, input) : invalidates),
        );
      }
      options.onSuccess?.(result, input);
      return result;
    } catch (thrown: unknown) {
      error.value = thrown;
      status.value = 'error';
      fetching.value = false;
      options.onError?.(thrown, input);
      return undefined;
    }
  };

  return {
    data,
    error,
    status,
    fetching,
    mutate,
    reset: () => {
      controller?.abort();
      data.value = undefined;
      error.value = undefined;
      status.value = 'idle';
      fetching.value = false;
    },
  };
}
