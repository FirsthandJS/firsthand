/**
 * Resources in components, the way an application uses them.
 *
 * The assertion to read is the middle one: a component that never heard of
 * the action shows the new value, because the action said what it changed and
 * the resource said what it was about. Nothing was shared, nothing was named.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, provide } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import {
  DataContext,
  createData,
  tag,
  useAction,
  useResource,
  type DataStore,
} from '@firsthandjs/data';

afterEach(cleanup);

const settle = (): Promise<void> => new Promise((wake) => setTimeout(wake, 20));

/** Mounts `inner` under a provided store. */
function withStore(store: DataStore, inner: () => unknown): ReturnType<typeof mount> {
  const Host = component(() => {
    provide(DataContext, store);
    return inner() as never;
  });
  return mount(() => <Host />);
}

describe('a resource in a component', () => {
  it('shows nothing, then the answer', async () => {
    const store = createData();
    let resolve!: (value: string) => void;
    const Name = component(() => {
      const user = useResource(() => new Promise<string>((done) => (resolve = done)));
      return <p>{user.data.value ?? 'loading'}</p>;
    });

    const view = withStore(store, () => <Name />);
    expect(view.text()).toBe('loading');

    resolve('Ada');
    await tick();
    await settle();

    expect(view.text()).toBe('Ada');
  });

  it('reads a prop inside the loader, which is what makes it follow', async () => {
    const store = createData();
    const asked: string[] = [];
    const Profile = component<{ id: string }>((props) => {
      const user = useResource(({ tags }) => {
        tags(tag('user', { id: props.id }));
        asked.push(props.id);
        return Promise.resolve(`user ${props.id}`);
      });
      return <p>{user.data.value ?? '…'}</p>;
    });

    const view = withStore(store, () => <Profile id="1" />);
    await settle();

    expect(view.text()).toBe('user 1');
    expect(asked).toEqual(['1']);
  });
});

describe('an action and a resource that never met', () => {
  it('meet through a tag', async () => {
    const store = createData();
    let name = 'Ada';

    const Shown = component(() => {
      const user = useResource(({ tags }) => {
        tags(tag('user', { id: 5 }));
        return Promise.resolve(name);
      });
      return <p>{user.data.value ?? '…'}</p>;
    });

    const Rename = component(() => {
      const rename = useAction(async (next: string, { invalidates }) => {
        name = next;
        await settle();
        invalidates(tag('user', { id: 5 }));
        return next;
      });
      return (
        <button
          onClick={() => {
            void rename.run('Grace');
          }}
        >
          rename
        </button>
      );
    });

    const view = withStore(store, () => (
      <>
        <Shown />
        <Rename />
      </>
    ));
    await settle();
    expect(view.text()).toContain('Ada');

    view.get<HTMLButtonElement>('button').click();
    await settle();
    await settle();

    expect(view.text()).toContain('Grace');
  });
});

describe('leaving a component', () => {
  it('takes its resource with it', async () => {
    const store = createData();
    const Inner = component(() => {
      const thing = useResource(() => Promise.resolve('value'));
      return <p>{thing.data.value ?? '…'}</p>;
    });
    const Host = component(() => {
      provide(DataContext, store);
      return (<Inner />) as never;
    });

    const view = mount(() => <Host />);
    await settle();
    expect(store.size).toBe(1);

    view.unmount();

    expect(store.size).toBe(0);
  });
});
