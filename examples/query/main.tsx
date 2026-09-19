/**
 * Tag-based caching, with the cache visible.
 *
 * Worth watching:
 *
 * 1. The request log at the bottom. Selecting a user you have already seen adds
 *    nothing to it — the entry is still in the cache.
 * 2. Renaming a user invalidates `user(id: …)` and `users`. The list and the
 *    detail both update, and neither knows the other exists: the only thing
 *    connecting them is the tag.
 * 3. During a refetch the old value stays on screen with a "fetching" mark,
 *    rather than flashing empty.
 */
import { component, provide, render, signal } from '@firsthandjs/dom';
import {
  QueryClientContext,
  createQueryClient,
  tag,
  useMutation,
  useQuery,
} from '@firsthandjs/query';
import { calls, listUsers, readUser, renameUser, type User } from './api';

const selected = signal(1);
const log = signal<string[]>([]);
const record = (): void => {
  log.value = [...calls];
};

const UserList = component(() => {
  const users = useQuery<User[]>(() => ({
    tags: [tag('users')],
    fetch: ({ signal }) => listUsers(signal).finally(record),
  }));

  return (
    <ul id="list" class={users.fetching.value ? 'fetching' : ''}>
      {users.status.value === 'pending' ? (
        <li>Loading…</li>
      ) : (
        (users.data.value ?? []).map((user) => (
          <li key={user.id}>
            <button
              class={selected.value === user.id ? 'active' : ''}
              onClick={() => (selected.value = user.id)}
            >
              {user.name}
            </button>
          </li>
        ))
      )}
    </ul>
  );
});

const UserDetail = component(() => {
  const user = useQuery<User>(() => {
    const id = selected.value;
    return {
      tags: [tag('user', { id })],
      fetch: ({ signal }) => readUser(id, signal).finally(record),
    };
  });

  const rename = useMutation<string, User>({
    mutate: (name, { signal }) => renameUser(selected.value, name, signal).finally(record),
    // Two tags, two different queries, neither of which this component knows.
    invalidates: (updated) => [tag('user', { id: updated.id }), tag('users')],
  });

  return (
    <section id="detail" data-fetching={String(user.fetching.value)}>
      <h2 id="name">{user.data.value?.name ?? '…'}</h2>
      <p id="role">{user.data.value?.role ?? ''}</p>
      <p>
        <button
          id="rename"
          disabled={rename.fetching.value}
          onClick={() => void rename.mutate(`Renamed ${String(Date.now() % 1000)}`)}
        >
          {rename.fetching.value ? 'Renaming…' : 'Rename'}
        </button>
        <button id="refetch" onClick={() => void user.refetch()}>
          Refetch
        </button>
      </p>
      <p id="status">
        status: {user.status.value}
        {user.fetching.value ? ' (fetching)' : ''}
      </p>
    </section>
  );
});

const RequestLog = component(() => (
  <footer>
    <h3>Requests</h3>
    <ol id="log">
      {log.value.map((entry, index) => (
        <li key={`${entry}-${String(index)}`}>{entry}</li>
      ))}
    </ol>
  </footer>
));

const App = component(() => {
  // Thirty seconds of freshness: long enough to see the cache work, short
  // enough that the page is not a museum.
  provide(QueryClientContext, createQueryClient({ staleTime: 30_000 }));

  return (
    <main>
      <h1>Firsthand query</h1>
      <UserList />
      <UserDetail />
      <RequestLog />
    </main>
  );
});

render(() => <App />);
