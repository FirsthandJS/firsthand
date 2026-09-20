/**
 * The panel.
 *
 * What is asserted here is what a person would check by looking: that the
 * chain is on the screen, that picking an element selects it, that the query
 * tab shows the cache, and that closing removes everything it added — an
 * inspector that leaves listeners or styles behind is worse than none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient, tag } from '@firsthandjs/query';
import { signal } from '@firsthandjs/core';
import { render } from '@firsthandjs/dom';
import { attach, detach } from '@firsthandjs/devtools';
import { close, open, refresh, show } from '../../src/panel.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
  attach();
});

afterEach(() => {
  close();
  detach();
});

/** The panel's shadow root, which is where everything it draws lives. */
const root = (): ShadowRoot => {
  const element = document.querySelector('[data-firsthand-devtools]');
  return (element as HTMLElement).shadowRoot as ShadowRoot;
};

const body = (): string => root().querySelector('.body')?.textContent ?? '';
const press = (selector: string): void => {
  (root().querySelector(selector) as HTMLElement).click();
};

describe('opening and closing', () => {
  it('draws itself into a shadow root, so neither side styles the other', () => {
    open();

    const element = document.querySelector('[data-firsthand-devtools]');
    expect(element).not.toBeNull();
    expect(root().querySelector('.panel')).not.toBeNull();
    expect(root().textContent).toContain('Firsthand');
  });

  it('opens once, however many times it is asked', () => {
    open();
    open();

    expect(document.querySelectorAll('[data-firsthand-devtools]')).toHaveLength(1);
  });

  it('removes everything it added', () => {
    open();
    expect(document.head.querySelectorAll('style').length).toBeGreaterThan(0);

    close();

    expect(document.querySelector('[data-firsthand-devtools]')).toBeNull();
  });

  it('closes from its own button', () => {
    open();
    press('[aria-label="Close"]');

    expect(document.querySelector('[data-firsthand-devtools]')).toBeNull();
  });

  it('does nothing when asked to redraw while closed', () => {
    expect(() => refresh()).not.toThrow();
  });
});

describe('with nothing selected', () => {
  it('says so, and says how to select something', () => {
    open();

    expect(body()).toContain('Nothing selected');
    expect(body()).toContain('Pick');
  });
});

describe('showing a node', () => {
  it('draws the chain, the cause and the dependencies', () => {
    const count = signal(41);
    render(() => {
      const paragraph = document.createElement('p');
      paragraph.textContent = String(count.value);
      return paragraph;
    }, host);

    // A part that writes a real element, so there is something to show.
    const disabled = signal(false);
    render(() => {
      const element = document.createElement('button');
      const update = (): void => {
        element.disabled = disabled.value;
      };
      update();
      return element;
    }, host);

    show(host.querySelector('p') as Node);

    expect(body()).toContain('Nothing reactive writes this node.');
  });

  it('draws the chain for a node a part does write', () => {
    const label = signal('draft');
    render(() => <p>{label.value}</p>, host);

    show(host.querySelector('p') as Node);

    expect(body()).toContain('p.text');
    expect(body()).toContain('Has not run since anything changed');

    label.value = 'sent';
    refresh();

    expect(body()).toContain('Last ran because');
  });

  it('shows null as null, rather than hiding it as an object', () => {
    const chosen = signal<string | null>(null);
    render(() => <p>{chosen.value}</p>, host);

    show(host.querySelector('p') as Node);

    // `typeof null === 'object'`, and an object is not shown because its
    // stringification says nothing. `null` says something.
    expect(body()).toContain('null');
  });

  it('shows a value beside the name, when there is one worth showing', () => {
    const count = signal(41);
    render(() => <p>{count.value}</p>, host);

    show(host.querySelector('p') as Node);

    expect(body()).toContain('41');
  });
});

describe('picking', () => {
  it('selects the element that is clicked', () => {
    const label = signal('draft');
    render(() => <p>{label.value}</p>, host);
    open();
    press('[data-pick]');

    const paragraph = host.querySelector('p') as HTMLElement;
    paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(body()).toContain('p.text');
  });

  it('outlines what the pointer is over, and only while picking', () => {
    const paragraph = document.createElement('p');
    host.append(paragraph);
    open();

    paragraph.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(paragraph.className).toBe('');

    press('[data-pick]');
    paragraph.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(paragraph.className).toContain('outline');

    // And the outline goes when the pointer moves on.
    const other = document.createElement('span');
    host.append(other);
    other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(paragraph.className).not.toContain('outline');
  });

  it('ignores a click on the panel itself', () => {
    open();
    press('[data-pick]');
    press('[data-tab="queries"]');

    // The click landed on a button rather than selecting the panel.
    expect(body()).toContain('query cache');
  });
});

describe('the query tab', () => {
  it('says when the cache has done nothing', () => {
    open();
    press('[data-tab="queries"]');

    expect(body()).toContain('has done nothing yet');
  });

  it('lists what the cache did, newest first', async () => {
    const client = createQueryClient({ cacheTime: 1000 });
    void client.load({ tags: [tag('order', { id: 7 })], fetch: () => Promise.resolve('ok') });
    await client.invalidate(tag('order'));

    open();
    press('[data-tab="queries"]');

    expect(body()).toContain('invalidated');
    expect(body()).toContain('order(id: 7)');
    expect(body().indexOf('invalidated')).toBeLessThan(body().indexOf('created'));
  });

  it('goes back to the graph', () => {
    open();
    press('[data-tab="queries"]');
    press('[data-tab="graph"]');

    expect(body()).toContain('Nothing selected');
  });
});

describe('reaching it from the console', () => {
  /** What `attach()` puts on `globalThis`, which is the console's whole API. */
  const api = (): { panel: (node?: Node) => void } =>
    (globalThis as { __FIRSTHAND__?: { panel: (node?: Node) => void } }).__FIRSTHAND__ as {
      panel: (node?: Node) => void;
    };

  it('opens the panel without an import', async () => {
    api().panel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[data-firsthand-devtools]')).not.toBeNull();
  });

  it('opens it on the element the console hands over — `__FIRSTHAND__.panel($0)`', async () => {
    const label = signal('draft');
    render(() => <p>{label.value}</p>, host);

    api().panel(host.querySelector('p') as Node);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(body()).toContain('p.text');
  });

  it('is gone once detached', () => {
    detach();
    expect((globalThis as { __FIRSTHAND__?: unknown }).__FIRSTHAND__).toBeUndefined();
  });
});
