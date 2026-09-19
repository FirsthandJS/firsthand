/**
 * The rest of the stack, in Storybook: the router and the query cache.
 *
 * Both are worth a story because both are the kind of thing that usually
 * *cannot* be told in isolation — a page that needs a router, a page that needs
 * a server. Here they can: the router takes a memory history, and the cache
 * takes whatever fetcher the story hands it.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { component, provide } from '@firsthandjs/dom';
import { Link, Outlet, Router, createMemoryHistory, useRouteParams } from '@firsthandjs/router';
import type { RouteDefinition } from '@firsthandjs/router';
import {
  QueryClientContext,
  createQueryClient,
  tag,
  useMutation,
  useQuery,
} from '@firsthandjs/query';
import { firsthand } from '../firsthand';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const Shell = component(() => (
  <main>
    <nav>
      <Link to="/">Home</Link> <Link to="/users/1">Ada</Link> <Link to="/users/2">Grace</Link>
    </nav>
    <Outlet />
  </main>
));

const User = component(() => {
  const params = useRouteParams<{ id: string }>();
  return <h2 data-testid="user">User {params.value.id}</h2>;
});

const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Shell,
    children: [
      { index: true, component: component(() => <p data-testid="home">Pick a user.</p>) },
      { path: 'users/:id', component: User },
    ],
  },
];

export const Routed: StoryObj = {
  name: 'Router (memory history)',
  render: () => firsthand(() => <Router routes={routes} history={createMemoryHistory(['/'])} />),
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
}

let stored: Profile = { name: 'Ada Lovelace' };

const ProfileCard = component(() => {
  const profile = useQuery<Profile>(() => ({
    tags: [tag('profile')],
    fetch: () => Promise.resolve(stored),
  }));
  const rename = useMutation<string, Profile>({
    mutate: (name) => {
      stored = { name };
      return Promise.resolve(stored);
    },
    invalidates: [tag('profile')],
  });

  return (
    <section data-fetching={String(profile.fetching.value)}>
      <h2 data-testid="profile">{profile.data.value?.name ?? 'Loading…'}</h2>
      <button data-testid="rename" onClick={() => void rename.mutate('Grace Hopper')}>
        Rename
      </button>
    </section>
  );
});

export const Cached: StoryObj = {
  name: 'Query (in-memory client)',
  render: () =>
    firsthand(() => {
      const App = component(() => {
        provide(QueryClientContext, createQueryClient({ staleTime: 10_000 }));
        return <ProfileCard />;
      });
      return <App />;
    }),
};

const meta: Meta = { title: 'Integration' };
export default meta;
