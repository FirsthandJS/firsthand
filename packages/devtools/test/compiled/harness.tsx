/**
 * The panel, looked at the way a person would.
 *
 * Only the queries are shared. Setting up and tearing down stays in each suite:
 * the element under test is replaced before every test, and a shared binding
 * for it would be a level of indirection over one line.
 */

import { close } from '@/panel.js';

import { attach, detach } from '@firsthandjs/devtools';

/** The panel's shadow root, which is where everything it draws lives. */
export const root = (): ShadowRoot => {
  const element = document.querySelector('[data-firsthand-devtools]');
  return (element as HTMLElement).shadowRoot as ShadowRoot;
};

export const body = (): string => root().querySelector('.body')?.textContent ?? '';

export const all = (selector: string): string[] =>
  [...root().querySelectorAll(selector)].map((element) => element.textContent ?? '');

export const one = (selector: string): Element | null => root().querySelector(selector);

export const press = (selector: string): void => {
  (root().querySelector(selector) as HTMLElement).click();
};

/** A fresh document and a fresh element to render into, before every test. */
export const fresh = (): HTMLElement => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  attach();
  return host;
};

export const done = (): void => {
  close();
  detach();
};
