/**
 * The rest of the stack, in Storybook: the router and the data layer.
 *
 * Both are worth a story because both are the kind of thing that usually
 * *cannot* be told in isolation — a page that needs a router, a page that needs
 * a server. Here they can: the router takes a memory history, and a resource
 * takes whatever loader the story hands it.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { component, provide } from '@firsthandjs/dom';
import { Link, Outlet, Router, createMemoryHistory, useRouteParams } from '@firsthandjs/router';
import type { RouteDefinition } from '@firsthandjs/router';
import { DataContext, createData, tag, useAction, useResource } from '@firsthandjs/data';
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
// Data
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
}

let stored: Profile = { name: 'Ada Lovelace' };

const ProfileCard = component(() => {
  const profile = useResource(({ tags }) => {
    tags(tag('profile'));
    return Promise.resolve(stored);
  });
  // The action knows nothing about the resource; the tag is the only thing
  // connecting them.
  const rename = useAction((name: string, { invalidates }) => {
    stored = { name };
    invalidates(tag('profile'));
    return Promise.resolve(stored);
  });

  return (
    <section data-fetching={String(profile.loading.value)}>
      <h2 data-testid="profile">{profile.data.value?.name ?? 'Loading…'}</h2>
      <button data-testid="rename" onClick={() => void rename.run('Grace Hopper')}>
        Rename
      </button>
    </section>
  );
});

export const Loaded: StoryObj = {
  name: 'Data (resource and action)',
  render: () =>
    firsthand(() => {
      const App = component(() => {
        provide(DataContext, createData());
        return <ProfileCard />;
      });
      return <App />;
    }),
};

const meta: Meta = { title: 'Integration' };
export default meta;
