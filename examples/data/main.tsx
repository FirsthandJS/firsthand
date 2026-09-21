/**
 * Resources and invalidation, with the requests visible.
 *
 * Worth watching:
 *
 * 1. Renaming a user invalidates `user(id: …)` and `users`. The list and the
 *    detail both reload, and neither knows the other exists: the only thing
 *    connecting them is the tag.
 * 2. The detail's loader reads `selected.value`, so selecting another user
 *    runs it again — the same way an `effect` would. Nothing was declared as
 *    a dependency.
 * 3. During a reload the old value stays on screen with a mark, rather than
 *    flashing empty.
 * 4. The request log at the bottom shows every call. There is no cache here;
 *    a request cache belongs to the transport, and this page has none.
 */
import { component, provide, render, signal } from '@firsthandjs/dom';
import { DataContext, createData, tag, useAction, useResource } from '@firsthandjs/data';
import { calls, listUsers, readUser, renameUser } from './api';

const selected = signal(1);
const log = signal<string[]>([]);
const record = (): void => {
  log.value = [...calls];
};

const UserList = component(() => {
  const users = useResource(({ signal, tags }) => {
    tags(tag('users'));
    return listUsers(signal).finally(record);
  });

  return (
    <ul id="list" class={users.loading.value ? 'fetching' : ''}>
      {users.status.value === 'loading' ? (
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
  const user = useResource(({ signal, tags }) => {
    // Read here, so it is a dependency: selecting another user runs this again.
    const id = selected.value;
    tags(tag('user', { id }));
    return readUser(id, signal).finally(record);
  });

  const rename = useAction(async (name: string, { signal, invalidates }) => {
    const updated = await renameUser(selected.value, name, signal).finally(record);
    // Two tags, two resources, neither of which this component knows about.
    invalidates(tag('user', { id: updated.id }), tag('users'));
    return updated;
  });

  return (
    <section id="detail" data-fetching={String(user.loading.value)}>
      <h2 id="name">{user.data.value?.name ?? '…'}</h2>
      <p id="role">{user.data.value?.role ?? ''}</p>
      <p>
        <button
          id="rename"
          disabled={rename.running.value}
          onClick={() => void rename.run(`Renamed ${String(Date.now() % 1000)}`)}
        >
          {rename.running.value ? 'Renaming…' : 'Rename'}
        </button>
        <button id="refetch" onClick={() => void user.reload()}>
          Refetch
        </button>
      </p>
      <p id="status">
        status: {user.status.value}
        {user.loading.value ? ' (loading)' : ''}
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
  provide(DataContext, createData());

  return (
    <main>
      <h1>Firsthand data</h1>
      <UserList />
      <UserDetail />
      <RequestLog />
    </main>
  );
});

render(() => <App />);
