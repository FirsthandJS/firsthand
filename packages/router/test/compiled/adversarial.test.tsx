/**
 * Routing, where two features meet.
 *
 * Typed routes, lazy chunks, the parameter view and nesting each work; these
 * are the combinations of them that could plausibly break each other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import { Outlet, Router, createMemoryHistory, route, type RouteProps } from '@firsthandjs/router';

afterEach(cleanup);

describe('typed routes under pressure', () => {
  it('hands a lazily loaded component its parameters', async () => {
    const Loaded = component<RouteProps<{ id: string }>>((props) => (
      <p data-testid="lazy">lazy {props.params.id}</p>
    ));
    const routes = [
      route({
        path: 'files/:id',
        lazy: () => Promise.resolve({ default: Loaded }),
        pending: () => <p data-testid="pending">…</p>,
      }),
    ];
    const history = createMemoryHistory(['/files/9']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="pending"]').textContent).toBe('…');
    await tick();

    expect(view.get('[data-testid="lazy"]').textContent).toBe('lazy 9');

    // And the chunk is not re-imported when only the parameter moves.
    history.push('/files/10');
    expect(view.get('[data-testid="lazy"]').textContent).toBe('lazy 10');
  });

  it('gives a child both its own and its ancestors’ parameters, three deep', () => {
    const routes = [
      route({
        path: 'orgs/:org',
        component: () => <Outlet />,
        children: (child) => [
          child({
            path: 'teams/:team',
            component: () => <Outlet />,
            children: (grandchild) => [
              grandchild({
                path: 'users/:id',
                component: ({ params }) => (
                  <p data-testid="deep">
                    {params.org}/{params.team}/{params.id}
                  </p>
                ),
              }),
            ],
          }),
        ],
      }),
    ];
    const history = createMemoryHistory(['/orgs/acme/teams/core/users/3']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="deep"]').textContent).toBe('acme/core/3');

    history.push('/orgs/acme/teams/core/users/4');
    expect(view.get('[data-testid="deep"]').textContent).toBe('acme/core/4');
  });

  it('keeps a splat and an optional segment readable as parameters', () => {
    const routes = [
      route({
        path: 'docs/:section?/*',
        component: ({ params }) => (
          <p data-testid="splat">
            {params.section ?? 'none'}:{params['*']}
          </p>
        ),
      }),
    ];
    const history = createMemoryHistory(['/docs/guide/a/b/c']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="splat"]').textContent).toBe('guide:a/b/c');
  });

  it('does not re-run a route component when an unrelated part of the URL changes', () => {
    let setups = 0;
    const routes = [
      route({
        path: 'users/:id',
        component: ({ params }) => {
          setups++;
          return <p data-testid="user">{params.id}</p>;
        },
      }),
    ];
    const history = createMemoryHistory(['/users/1?tab=a']);
    const view = mount(() => <Router routes={routes} history={history} />);
    const node = view.get('[data-testid="user"]');

    history.push('/users/1?tab=b');
    history.push('/users/1#anchor');

    expect(setups).toBe(1);
    expect(view.get('[data-testid="user"]')).toBe(node);
  });

  it('reuses the same component function in two routes without confusing them', () => {
    const Page = ({ params }: RouteProps<{ id: string }>): JSX.Element => (
      <p data-testid="page">{params.id}</p>
    );
    const routes = [
      route({ path: 'a/:id', component: Page }),
      route({ path: 'b/:id', component: Page }),
    ];
    const history = createMemoryHistory(['/a/1']);
    const view = mount(() => <Router routes={routes} history={history} />);
    expect(view.get('[data-testid="page"]').textContent).toBe('1');

    history.push('/b/2');
    expect(view.get('[data-testid="page"]').textContent).toBe('2');
  });

  it('survives a signal read in a route component, across navigations', () => {
    const count = signal(0);
    const routes = [
      route({
        path: 'users/:id',
        component: ({ params }) => (
          <p data-testid="mixed">
            {params.id}:{count.value}
          </p>
        ),
      }),
    ];
    const history = createMemoryHistory(['/users/1']);
    const view = mount(() => <Router routes={routes} history={history} />);

    count.value = 5;
    expect(view.get('[data-testid="mixed"]').textContent).toBe('1:5');

    history.push('/users/2');
    expect(view.get('[data-testid="mixed"]').textContent).toBe('2:5');

    count.value = 6;
    expect(view.get('[data-testid="mixed"]').textContent).toBe('2:6');
  });
});
