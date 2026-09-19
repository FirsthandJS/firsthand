/**
 * Routing, nested layouts, and a page that arrives on demand.
 *
 * Three things are worth watching in the browser:
 *
 * 1. "shell setup" is printed once. Navigating never re-creates the layout.
 * 2. Moving between `/users/1` and `/users/2` prints nothing: the user page is
 *    updated, not replaced, because only the parameter changed.
 * 3. The network tab stays quiet until you hover "Reports" — that is the
 *    moment its chunk is fetched.
 */
import { component, render } from '@firsthandjs/dom';
import {
  Link,
  NavLink,
  Outlet,
  Router,
  useNavigate,
  route,
  type RouteProps,
} from '@firsthandjs/router';

interface User {
  readonly id: number;
  readonly name: string;
  readonly role: string;
}

const USERS: readonly User[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Analyst' },
  { id: 2, name: 'Grace Hopper', role: 'Rear Admiral' },
  { id: 3, name: 'Karen Spärck Jones', role: 'Researcher' },
];

const Shell = component(() => {
  console.info('shell setup');
  return (
    <main>
      <h1>Firsthand router</h1>
      <nav id="nav">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/users">Users</NavLink>
        <NavLink to="/reports" preload>
          Reports
        </NavLink>
      </nav>
      <Outlet />
    </main>
  );
});

const Home = component(() => (
  <section data-page="home">
    <h2>Home</h2>
    <p>
      The layout above this text was created once. Every navigation below replaces only what
      actually differs.
    </p>
  </section>
));

const Users = component(() => (
  <section data-page="users">
    <h2>Users</h2>
    <ul>
      {USERS.map((user) => (
        <li key={user.id}>
          <Link to={`/users/${String(user.id)}`}>{user.name}</Link>
        </li>
      ))}
    </ul>
    <Outlet />
  </section>
));

/**
 * `props.params` is typed by the route's own path — see `route()` below — so
 * `id` is not declared a second time here.
 */
const UserDetail = component<RouteProps<{ id: string }>>((props) => {
  console.info('user setup');
  const navigate = useNavigate();
  const user = (): User | undefined =>
    USERS.find((candidate) => String(candidate.id) === props.params.id);

  return (
    <article data-page="user">
      <h3 id="user-name">{user()?.name ?? 'Unknown user'}</h3>
      <p id="user-role">{user()?.role ?? '—'}</p>
      <button onClick={() => navigate(-1)}>back</button>
    </article>
  );
});

const NotFound = component(() => (
  <section data-page="missing">
    <h2>Nothing here</h2>
    <Link to="/">Go home</Link>
  </section>
));

const routes = [
  route({
    path: '/',
    component: Shell,
    children: (child) => [
      child({ index: true, component: Home }),
      child({
        path: 'users',
        component: Users,
        children: (grandchild) => [grandchild({ path: ':id', component: UserDetail })],
      }),
      child({
        path: 'reports',
        // The code-splitting seam. The bundler emits a separate chunk, and the
        // browser fetches it when this route is entered — or earlier, because
        // the link above asks for it on hover.
        lazy: () => import('./reports'),
        pending: () => <p data-page="pending">Loading the reports module…</p>,
      }),
      child({ path: '*', component: NotFound }),
    ],
  }),
];

// The application is served under `/router/`, and no route mentions that.
render(() => <Router routes={routes} basename="/router" />);
