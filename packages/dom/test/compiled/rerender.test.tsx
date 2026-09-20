/**
 * Forcing a fresh instance.
 *
 * A component body runs once, which raises the obvious question: what if you
 * *want* it to run again — to reset everything it set up, the way React's
 * `key` trick does? It is possible, and it is the same mechanism a keyed list
 * already uses: the instance is not re-rendered, it is replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, onCleanup, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

describe('re-creating a component on purpose', () => {
  it('runs setup again, and disposes the instance it replaces', () => {
    let setups = 0;
    let cleanups = 0;

    const Editor = component<{ initial: string }>((props) => {
      setups++;
      const draft = signal(props.initial);
      onCleanup(() => cleanups++);
      return (
        <input value={draft.value} onInput={(event) => (draft.value = event.currentTarget.value)} />
      );
    });

    // The version is read *inside* the child position, so the part that holds
    // the component re-evaluates when it changes — and a component call in a
    // re-evaluated part is a new instance.
    const version = signal(0);
    const view = mount(() => <div>{(version.value, (<Editor initial="hello" />))}</div>);

    const first = view.get<HTMLInputElement>('input');
    first.value = 'edited by the user';
    expect(setups).toBe(1);
    expect(cleanups).toBe(0);

    version.value++;

    const second = view.get<HTMLInputElement>('input');
    expect(setups).toBe(2);
    // The old instance is gone: its cleanups ran, and its element with it.
    expect(cleanups).toBe(1);
    expect(second).not.toBe(first);
    expect(second.value).toBe('hello');
  });

  it('also works by keying a list of one, which is the familiar spelling', () => {
    let setups = 0;
    const Panel = component<{ id: number }>((props) => {
      setups++;
      return <p data-testid="panel">panel {props.id}</p>;
    });

    const id = signal(1);
    const view = mount(() => (
      <div>
        {[id.value].map((value) => (
          <Panel key={value} id={value} />
        ))}
      </div>
    ));

    expect(setups).toBe(1);
    const first = view.get('[data-testid="panel"]');

    id.value = 2;
    expect(setups).toBe(2);
    expect(view.get('[data-testid="panel"]')).not.toBe(first);
    expect(view.text()).toBe('panel 2');
  });

  it('does not re-create when the props change but the identity does not', () => {
    let setups = 0;
    const Label = component<{ text: string }>((props) => {
      setups++;
      return <span data-testid="label">{props.text}</span>;
    });

    const text = signal('one');
    const view = mount(() => (
      <div>
        <Label text={text.value} />
      </div>
    ));
    const node = view.get('[data-testid="label"]');

    text.value = 'two';

    // The ordinary path: same instance, same element, new text.
    expect(setups).toBe(1);
    expect(view.get('[data-testid="label"]')).toBe(node);
    expect(view.text()).toBe('two');
  });
});
