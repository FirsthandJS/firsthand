/**
 * A part never runs after what owns it decided it should not exist.
 *
 * Reported against 0.12.2 from an editor: an inspector inside a conditional
 * read the selected part, and deleting the last part ran the inspector before
 * the conditional that was about to remove it. The read failed, the error came
 * out of the delete handler's write, and nothing on the screen updated again.
 *
 * Both shapes here put the inner part's edge *ahead* of its owner's in the
 * subscriber list, which is what reaches it first: a condition switched off
 * and on again, and a computed that a sibling read before the list existed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, computed, signal } from '@firsthandjs/dom';

type Part = { id: string; name: string };

afterEach(() => {
  cleanup();
});

describe('an owner before the parts it owns', () => {
  it('removes a conditional child instead of running it against missing data', () => {
    const parts = signal<Part[]>([{ id: 'a', name: 'A' }]);
    const id = signal<string | null>('a');
    const selected = computed(() => parts.value.find((p) => p.id === id.value));
    const name = computed(() => (selected.value as Part).name);
    const has = computed(() => id.value !== null && selected.value !== undefined);

    const Child = component(() => <b>{name.value}</b>);
    const App = component(() => (
      <div>
        {has.value ? <Child /> : <i>none</i>}
        <span>{parts.value.length}</span>
      </div>
    ));

    const { container } = mount(() => <App />);
    expect(container.textContent).toBe('A1');
    id.value = null;
    id.value = 'a';
    expect(container.textContent).toBe('A1');

    expect(() => {
      parts.value = [];
    }).not.toThrow();
    expect(container.textContent).toBe('none0');

    parts.value = [{ id: 'b', name: 'B' }];
    id.value = 'b';
    expect(container.textContent).toBe('B1');
  });

  it('removes a list row before the row reads what it was removed for', () => {
    const parts = signal<Part[]>([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
    ]);
    // Read by the `<span>` before the list exists, so its edge to `parts` is
    // older than the list's, and the rows behind it are notified first.
    const names = computed(() => new Map(parts.value.map((p) => [p.id, p.name])));
    const zombies: string[] = [];
    const nameOf = (id: string): string => {
      const name = names.value.get(id);
      if (name === undefined) {
        zombies.push(id);
        return '?';
      }
      return name.toUpperCase();
    };

    const App = component(() => (
      <div>
        <span>{names.value.size}</span>
        <ul>
          {parts.value.map((p) => (
            <li key={p.id}>{nameOf(p.id)}</li>
          ))}
        </ul>
      </div>
    ));

    const { container } = mount(() => <App />);
    expect(container.textContent).toBe('2AB');

    parts.value = [{ id: 'b', name: 'b' }];
    expect(container.textContent).toBe('1B');
    expect(zombies).toEqual([]);
  });
});
