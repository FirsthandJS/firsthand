import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catchError, createRoot } from '@firsthandjs/core';
import {
  component,
  setElementPrefix,
  createComponent,
  defineElement,
  isComponent,
  tagNameFor,
} from '@/component.js';
import { render } from '@/render.js';
import { insert } from '@/insert.js';

let host: HTMLElement;
let unique = 0;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Component names must be unique per test: custom element names are global. */
const uniqueName = (base: string): string => `${base}${++unique}`;

describe('hostless components', () => {
  it('marks components and derives a display name', () => {
    const Widget = component(() => null, undefined, 'pkg/Widget', 'Widget');
    expect(isComponent(Widget)).toBe(true);
    expect(isComponent({})).toBe(false);
    expect(isComponent(null)).toBe(false);
    expect(Widget.name).toBe('Widget');
  });

  it('warns once when declared without the compiler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    component(function Anonymous() {
      return null;
    });
    component(() => null);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('without the Firsthand compiler');
    warn.mockRestore();
  });

  it('routes a setup error to the enclosing boundary', () => {
    const handler = vi.fn();
    const Broken = component(
      () => {
        throw new Error('setup exploded');
      },
      undefined,
      'pkg/Broken',
      'Broken',
    );
    createRoot((dispose) => {
      const result = catchError(() => createComponent(Broken, {}), handler);
      expect(result).toBeNull();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ message: 'setup exploded' }));
      dispose();
    });
  });
});

describe('custom element hosts', () => {
  it('derives a tag name from the identifier and the configured prefix', () => {
    setElementPrefix('acme');
    const UserCard = component(() => null, undefined, 'pkg/UserCard', 'UserCard');
    expect(tagNameFor(UserCard)).toBe('acme-user-card');
    setElementPrefix('firsthand');
  });

  it('registers an element and mounts the same setup function', () => {
    const name = uniqueName('Badge');
    const Badge = component(
      () => {
        const span = document.createElement('span');
        span.textContent = 'badge';
        return span;
      },
      { tag: true },
      `pkg/${name}`,
      name,
    );
    expect(Badge.tag).toBe(`firsthand-${name.toLowerCase()}`);
    const dispose = render(() => createComponent(Badge, {}), host);
    const element = host.firstElementChild as HTMLElement;
    expect(element.tagName.toLowerCase()).toBe(Badge.tag);
    expect(element.textContent).toBe('badge');
    dispose();
    expect(host.innerHTML).toBe('');
  });

  it('is idempotent: defining twice keeps the first tag', () => {
    const name = uniqueName('Once');
    const Once = component(() => null, { tag: true }, `pkg/${name}`, name);
    const first = Once.tag as string;
    expect(defineElement(Once as never)).toBe(first);
  });

  it('disambiguates a tag name that is already taken', () => {
    const taken = uniqueName('taken-name').toLowerCase();
    customElements.define(taken, class extends HTMLElement {});
    const Conflict = component(() => null, undefined, 'pkg/Conflict', 'Conflict');
    const registered = defineElement(Conflict as never, taken);
    expect(registered).not.toBe(taken);
    expect(registered.startsWith(taken)).toBe(true);
  });

  it('attaches a shadow root when asked', () => {
    const name = uniqueName('Shadowed');
    const Shadowed = component(
      () => {
        const span = document.createElement('span');
        span.textContent = 'inside';
        return span;
      },
      { tag: true, shadow: true },
      `pkg/${name}`,
      name,
    );
    const dispose = render(() => createComponent(Shadowed, {}), host);
    const element = host.firstElementChild as HTMLElement;
    expect(element.shadowRoot?.textContent).toBe('inside');
    expect(element.textContent).toBe('');
    dispose();
  });

  it('maps attributes to reactive props for markup consumers', () => {
    const name = uniqueName('Counter');
    const Counter = component(
      (props: { count: number }) => {
        const span = document.createElement('span');
        insert(span, () => String(props.count));
        return span;
      },
      { tag: true, attributes: { count: (raw) => Number(raw ?? 0) } },
      `pkg/${name}`,
      name,
    );
    const element = document.createElement(Counter.tag as string);
    element.setAttribute('count', '3');
    host.appendChild(element);
    expect(element.textContent).toBe('3');

    element.setAttribute('count', '4');
    expect(element.textContent).toBe('4');

    // An attribute outside the schema is ignored.
    element.setAttribute('other', 'x');
    expect(element.textContent).toBe('4');
  });

  it('disposes a standalone element when it leaves the document', () => {
    const cleaned = vi.fn();
    const name = uniqueName('Standalone');
    const Standalone = component(
      () => {
        const span = document.createElement('span');
        span.textContent = 'here';
        queueMicrotask(() => undefined);
        return span;
      },
      { tag: true },
      `pkg/${name}`,
      name,
    );
    const element = document.createElement(Standalone.tag as string);
    host.appendChild(element);
    expect(element.textContent).toBe('here');
    element.remove();
    element.remove();
    expect(cleaned).not.toHaveBeenCalled();
  });

  it('does not dispose a Firsthand-created host when it is moved', () => {
    const name = uniqueName('Movable');
    const Movable = component(
      () => {
        const span = document.createElement('span');
        span.textContent = 'moved';
        return span;
      },
      { tag: true },
      `pkg/${name}`,
      name,
    );
    const dispose = render(() => createComponent(Movable, {}), host);
    const element = host.firstElementChild as HTMLElement;
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    elsewhere.appendChild(element);
    expect(element.textContent).toBe('moved');
    dispose();
  });

  it('reports a setup failure inside an element host', () => {
    const scheduled: (() => void)[] = [];
    const spy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback: () => void) => void scheduled.push(callback));
    const name = uniqueName('Failing');
    const Failing = component(
      () => {
        throw new Error('host setup failed');
      },
      { tag: true },
      `pkg/${name}`,
      name,
    );
    const dispose = render(() => createComponent(Failing, {}), host);
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow('host setup failed');
    spy.mockRestore();
    dispose();
  });
});
