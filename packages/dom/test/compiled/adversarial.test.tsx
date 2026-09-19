/**
 * The awkward combinations.
 *
 * Each of these is a place where two features meet and could plausibly get in
 * each other's way. They are written as one file because what they have in
 * common is the reason they exist, not the feature they exercise.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  catchError,
  component,
  computed,
  onCleanup,
  setComponentAdapter,
  signal,
  type Component,
  type View,
} from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(() => {
  cleanup();
  setComponentAdapter(null);
});

/** An adapter that renders a foreign component's string result. */
function installAdapter(): void {
  setComponentAdapter(
    (target) =>
      component<{ label: string }>((props) => (
        <i>{(target as unknown as (props: { label: string }) => string)({ label: props.label })}</i>
      )) as unknown as Component<never>,
  );
}

function Foreign(props: { readonly label: string }): string {
  return props.label;
}

describe('adapted components in awkward positions', () => {
  it('survive being rows of a keyed list', () => {
    installAdapter();
    const items = signal([1, 2, 3]);
    const view = mount(() => (
      <ul>
        {items.value.map((id) => (
          <li key={id}>
            <Foreign label={`item ${String(id)}`} />
          </li>
        ))}
      </ul>
    ));

    expect(view.all('i').map((node) => node.textContent)).toEqual(['item 1', 'item 2', 'item 3']);

    const second = view.all('li')[1];
    items.value = [3, 2, 1];
    // Reordering keeps the rows, adapter or not.
    expect(view.all('i').map((node) => node.textContent)).toEqual(['item 3', 'item 2', 'item 1']);
    expect(view.all('li')[1]).toBe(second);
  });

  it('are disposed with the branch that held them', () => {
    let disposed = 0;
    setComponentAdapter(
      () =>
        component<{ label: string }>((props) => {
          onCleanup(() => disposed++);
          return <i>{props.label}</i>;
        }) as unknown as Component<never>,
    );

    const shown = signal(true);
    const view = mount(() => <div>{shown.value ? <Foreign label="here" /> : null}</div>);
    expect(view.text()).toBe('here');

    shown.value = false;
    expect(view.text()).toBe('');
    expect(disposed).toBe(1);
  });

  it('report their errors to the boundary that contains them', () => {
    setComponentAdapter(
      () =>
        component(() => {
          throw new Error('adapter blew up');
        }) as unknown as Component<never>,
    );

    const failure = signal<unknown>(null);
    const Safe = component(() => {
      return catchError(
        () => <Foreign label="x" />,
        (error) => (failure.value = error),
      );
    });

    mount(() => <Safe />);
    expect((failure.value as Error).message).toBe('adapter blew up');
  });
});

describe('computed props through an adapter', () => {
  it('update without re-adapting', () => {
    installAdapter();
    const count = signal(1);
    const label = computed(() => `count ${String(count.value)}`);
    const view = mount((): View => <Foreign label={label.value} />);

    expect(view.text()).toBe('count 1');
    count.value = 2;
    expect(view.text()).toBe('count 2');
  });
});
