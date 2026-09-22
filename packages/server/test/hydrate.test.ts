/**
 * Taking over what the server sent.
 *
 * Two things have to hold, and both are asserted for every fixture:
 *
 * - **The tree is the tree.** After hydration the live DOM is compared node
 *   for node — not with runs of text joined, as the markup comparison does,
 *   but exactly — against the same view rendered from nothing. If hydration
 *   left a marker behind, ran a text node together, or adopted a node into the
 *   wrong place, the trees differ and this says so.
 * - **Nothing was rebuilt.** Every node the server sent is recorded before
 *   hydration and looked for afterwards by identity. A hydration that quietly
 *   re-rendered would pass the first check and fail this one, which is the
 *   failure worth catching: it is invisible and it costs everything.
 *
 * And then the application has to work, so the last tests click a button and
 * watch the text change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent, render, type Component } from '@firsthandjs/dom';
import { hydrate } from '@firsthandjs/dom/hydrate';
import { createComponent as createServerComponent } from '@firsthandjs/server/internal';
import { renderToString } from '@firsthandjs/server';
import { inside } from './tree.js';
import * as client from './compiled/fixtures.js';
import * as serverModule from './compiled/fixtures.js?server';

const server = serverModule as unknown as typeof client;

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
});

function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

/** Every element and text node in a tree, by identity. */
function nodes(root: Node): Node[] {
  const found: Node[] = [];
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 8) {
        found.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

type Hydrated = {
  readonly container: HTMLElement;
  /** The server's nodes, recorded before the client touched them. */
  readonly sent: Node[];
};

function fromServer(name: keyof typeof client, props: unknown): Hydrated {
  const container = host();
  container.innerHTML = renderToString(() => createServerComponent(server[name] as never, props));
  const sent = nodes(container);
  disposers.push(
    hydrate(() => createComponent(client[name] as unknown as Component<unknown>, props), container),
  );
  return { container, sent };
}

function fresh(name: keyof typeof client, props: unknown): HTMLElement {
  const container = host();
  disposers.push(
    render(() => createComponent(client[name] as unknown as Component<unknown>, props), container),
  );
  return container;
}

function hydrates(name: keyof typeof client, props: unknown): void {
  describe(name, () => {
    it('ends with the tree a fresh render builds', () => {
      const { container } = fromServer(name, props);
      expect(inside(container)).toBe(inside(fresh(name, props)));
    });

    it('keeps every node the server sent', () => {
      const { container, sent } = fromServer(name, props);
      const kept = new Set(nodes(container));
      expect(sent.filter((node) => !kept.has(node))).toEqual([]);
    });
  });
}

describe('hydration', () => {
  hydrates('Plain', {});
  hydrates('Void', {});
  hydrates('Nested', {});
  hydrates('Text', { name: 'Ada' });
  hydrates('Escaping', { raw: '<script>"x" & y</script>' });
  hydrates('ManyHoles', { a: 'one', b: 'two' });
  hydrates('Attributes', { title: 'a title', id: 'seven', missing: undefined });
  hydrates('Namespaced', { value: 'v' });
  hydrates('Classes', { names: { on: true, off: false }, list: ['a', 'b'] });
  hydrates('Styles', { style: { marginTop: '1px' }, text: 'color: blue' });
  hydrates('Booleans', { on: true, off: false });
  hydrates('Fragments', { items: ['a', 'b'] });
  hydrates('Keyed', { items: ['a', 'b', 'c'] });
  hydrates('Composed', { label: 'shown' });
  hydrates('WithChildren', { label: 'slotted' });
  hydrates('WithView', { text: 'viewed' });
  hydrates('Render', { label: 'count' });
  hydrates('Branch', { wide: true });
  hydrates('Provider', { theme: 'dark' });
  hydrates('Spread', { attributes: { title: 'spread' } });
  hydrates('Conditional', { show: true });
  hydrates('Conditional', { show: false });
  hydrates('Nothing', {});
  hydrates('RunChild', { label: 'run' });
  hydrates('RunList', { items: ['a', 'b'] });
  hydrates('ListOfComponents', { items: ['a', 'b'] });
  hydrates('ListOfRenderComponents', { items: ['a', 'b'] });
  hydrates('Deep', { label: 'deep' });
  hydrates('RunNothing', { label: 'x' });
  hydrates('RunPair', { label: 'x' });
  hydrates('NestedRun', { label: 'x' });
});

describe('markup a run keeps in a variable', () => {
  /*
   * A run that writes `const shown = <span/>` builds that element before the
   * element it goes into — locals come before the return — while the markup it
   * has to be adopted from is the other way round: the `div` is what the
   * region holds, and the `span` is inside it. So the `span` is built rather
   * than adopted, and the part that writes it replaces what the server sent.
   *
   * The page is right, and one element is rebuilt. Writing the markup where it
   * is used, which is how JSX is usually written, adopts it as everything else
   * does.
   */
  it('ends with the tree a fresh render builds', () => {
    const { container } = fromServer('RunElement', { label: 'x' });
    expect(inside(container)).toBe(inside(fresh('RunElement', { label: 'x' })));
  });

  it('keeps everything around it', () => {
    const { container, sent } = fromServer('RunElement', { label: 'x' });
    const kept = new Set(nodes(container));
    const lost = sent.filter((node) => !kept.has(node));
    // The element the local held, and the text inside it.
    expect(lost.map((node) => node.nodeName)).toEqual(['SPAN', '#text']);
  });
});

describe('a hydrated application', () => {
  it('reacts to a click', () => {
    const { container } = fromServer('Render', { label: 'count' });
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(container.querySelector('span')?.textContent).toBe('count: 2');
    button.click();
    expect(container.querySelector('span')?.textContent).toBe('count: 3');
  });

  it('writes the text node the server sent rather than a new one', () => {
    const { container } = fromServer('Render', { label: 'count' });
    const before = container.querySelector('span')?.firstChild;
    (container.querySelector('button') as HTMLButtonElement).click();
    expect(container.querySelector('span')?.firstChild).toBe(before);
  });
});
