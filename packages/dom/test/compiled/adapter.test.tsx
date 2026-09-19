/**
 * Element types Firsthand does not own.
 *
 * No React here on purpose: the seam is framework-agnostic, and a test that
 * needed React to exercise it would prove the opposite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FirsthandComponentError,
  component,
  setComponentAdapter,
  signal,
  type Component,
} from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(() => {
  cleanup();
  setComponentAdapter(null);
});

/**
 * A component from some other framework: a plain function, no marker.
 *
 * Whatever it returns is that framework's business; Firsthand never looks at it,
 * only the adapter does.
 */
function Foreign(props: { readonly label: string }): string {
  return props.label;
}

describe('the component adapter', () => {
  it('throws, naming the fix, when nothing is installed', () => {
    expect(() => mount(() => <Foreign label="hi" />)).toThrow(FirsthandComponentError);
    expect(() => mount(() => <Foreign label="hi" />)).toThrow(/@firsthandjs\/react\/auto/);
  });

  it('names the value when the function is anonymous', () => {
    const Anonymous = (): null => null;
    Object.defineProperty(Anonymous, 'name', { value: '' });
    expect(() => mount(() => <Anonymous />)).toThrow(/The value is not a Firsthand component/);
  });

  it('renders through an installed adapter', () => {
    setComponentAdapter(
      (target) =>
        component<{ label: string }>((props) => {
          const rendered = (target as unknown as typeof Foreign)({ label: props.label });
          return <em data-testid="foreign">{rendered}</em>;
        }) as unknown as Component<never>,
    );

    const view = mount(() => <Foreign label="adapted" />);
    expect(view.get('[data-testid="foreign"]').textContent).toBe('adapted');
  });

  it('adapts a component once, however many instances it has', () => {
    const adapt = vi.fn((target: (props: never) => unknown) =>
      component<{ label: string }>((props) => (
        <em>{(target as unknown as typeof Foreign)({ label: props.label })}</em>
      )),
    );
    setComponentAdapter(adapt as never);

    const view = mount(() => (
      <>
        <Foreign label="one" />
        <Foreign label="two" />
      </>
    ));

    expect(view.all('em').map((element) => element.textContent)).toEqual(['one', 'two']);
    // Once per component type, not once per instance: an adapter usually holds
    // per-component state, and two of them would be two component types.
    expect(adapt).toHaveBeenCalledTimes(1);
  });

  it('keeps props reactive through the adapter', () => {
    setComponentAdapter(
      () =>
        component<{ label: string }>((props) => (
          <em>{props.label}</em>
        )) as unknown as Component<never>,
    );

    const label = signal('before');
    const view = mount(() => <Foreign label={label.value} />);
    expect(view.text()).toBe('before');

    label.value = 'after';
    expect(view.text()).toBe('after');
  });
});
