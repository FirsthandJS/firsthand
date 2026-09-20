/**
 * The mistake that used to be silent.
 *
 * `<p>{count}</p>` — a signal rendered without reading it — is rejected by
 * TypeScript now, but plain JavaScript and the runtime JSX path have no types
 * to reject it with. Development says so instead of showing `[object Object]`
 * and leaving you to wonder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('rendering something that is not a view', () => {
  it('warns that a signal was rendered instead of read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = signal(41);

    const view = mount(() => <p>{count as never}</p>);

    expect(view.text()).toBe('[object Object]');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('{count.value} rather than {count}'));
  });

  it('warns differently for an ordinary object, and says what it rendered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mount(() => <p>{{ a: 1 } as never}</p>);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('An object was rendered as text'));
  });

  it('says nothing for the values a view is made of', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = signal(41);

    const view = mount(() => (
      <p>
        {count.value} {'text'} {null} {true} {[1, 2]}
      </p>
    ));

    expect(view.text()).toContain('41');
    expect(warn).not.toHaveBeenCalled();
  });
});
