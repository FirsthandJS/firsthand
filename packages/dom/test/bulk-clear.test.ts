/**
 * Emptying a child slot that is the whole of its parent.
 *
 * Removing ten thousand rows one at a time is ten thousand mutations. When the
 * slot is everything the parent has, the platform has one call for that, and
 * this is where it is asserted to be the one that gets made — a change nobody
 * can see in the resulting tree is a change that silently stops happening.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyChild } from '@/insert.js';

const nodes = (parent: Element, count: number): Node[] => {
  const made: Node[] = [];
  for (let i = 0; i < count; i++) {
    const row = document.createElement('p');
    parent.append(row);
    made.push(row);
  }
  return made;
};

type Spy = { mockRestore(): void };

let removed: Spy | null = null;
let emptied: Spy | null = null;

afterEach(() => {
  removed?.mockRestore();
  emptied?.mockRestore();
  removed = null;
  emptied = null;
});

/**
 * Counts the removals, and whether the bulk call was the one that was made.
 *
 * Asserting the count alone would not do: an emulated DOM is free to implement
 * the bulk call as a loop of removals, and a real browser is free not to. What
 * this suite is about is which call the framework makes.
 */
function watch(): () => { removals: number; bulk: number } {
  let removals = 0;
  let bulk = 0;
  /*
   * Taken off the prototype and called back with an explicit receiver, which
   * is the only way to wrap a prototype method. The rule is about losing
   * `this` by accident; here it is passed by hand on every call.
   */
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = Node.prototype.removeChild;
  removed = vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function (
    this: Node,
    child: Node,
  ): Node {
    removals++;
    return original.call(this, child);
  });
  // `textContent` is declared on `Node` by the standard and on `Element` by
  // some implementations. The spy goes wherever the accessor actually is.
  const owner = (
    Object.getOwnPropertyDescriptor(Element.prototype, 'textContent') === undefined
      ? Node.prototype
      : Element.prototype
  ) as { textContent: string };
  const text = Object.getOwnPropertyDescriptor(owner, 'textContent') as PropertyDescriptor;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const write = text.set as (this: Node, value: string) => void;
  emptied = vi.spyOn(owner, 'textContent', 'set').mockImplementation(function setter(
    this: Node,
    value: string,
  ): void {
    if (value === '') {
      bulk++;
    }
    write.call(this, value);
  });
  return () => ({ removals, bulk });
}

describe('emptying a slot', () => {
  it('takes one call when the slot is the parent`s whole content', () => {
    const parent = document.createElement('div');
    const current = nodes(parent, 5);
    const counted = watch();
    expect(applyChild(parent, null, current, [])).toBe(null);
    expect(parent.childNodes).toHaveLength(0);
    expect(counted().bulk).toBe(1);
  });

  it('removes them one by one when something else shares the parent', () => {
    const parent = document.createElement('div');
    const current = nodes(parent, 5);
    parent.append(document.createElement('hr'));
    const counted = watch();
    applyChild(parent, null, current, []);
    expect(parent.childNodes).toHaveLength(1);
    expect(counted()).toEqual({ removals: 5, bulk: 0 });
  });

  it('removes them one by one when a marker follows the slot', () => {
    const parent = document.createElement('div');
    const current = nodes(parent, 5);
    const marker = document.createComment('');
    parent.append(marker);
    const counted = watch();
    applyChild(parent, marker, current, []);
    expect(parent.childNodes).toHaveLength(1);
    expect(counted()).toEqual({ removals: 5, bulk: 0 });
  });

  it('removes one node as one node', () => {
    const parent = document.createElement('div');
    const [only] = nodes(parent, 1);
    const counted = watch();
    applyChild(parent, null, only as Node, null);
    expect(parent.childNodes).toHaveLength(0);
    expect(counted()).toEqual({ removals: 1, bulk: 0 });
  });

  it('takes the same one call when the value becomes nothing at all', () => {
    const parent = document.createElement('div');
    const current = nodes(parent, 5);
    const counted = watch();
    expect(applyChild(parent, null, current, null)).toBe(null);
    expect(parent.childNodes).toHaveLength(0);
    expect(counted().bulk).toBe(1);
  });

  it('removes them one by one when one of them has been moved away', () => {
    const parent = document.createElement('div');
    const current = nodes(parent, 5);
    document.createElement('section').append(current[2] as Node);
    const counted = watch();
    applyChild(parent, null, current, []);
    expect(parent.childNodes).toHaveLength(0);
    expect(counted().bulk).toBe(0);
  });
});
