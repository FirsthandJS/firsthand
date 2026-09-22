/**
 * The small pieces every view is built from.
 *
 * Plain DOM, deliberately: this runs inside the page it is inspecting, so it
 * must not create parts, own scopes or appear in the graph it is showing.
 * Rendering it with the framework would put the inspector into its own results.
 */

import { original } from './source.js';

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  element.setAttribute('aria-pressed', 'false');
  element.addEventListener('click', onClick);
  return element;
}

export function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/**
 * A frame as a person reads it: `handleSave (order.ts:31:7)`.
 *
 * A development server serves modules by URL, so an untouched frame is most of
 * a line of `http://localhost:5173/src/…` before it says anything useful.
 */
function shorten(frame: string): string {
  const parts = /^(.*?)\(?([^()\s]+):(\d+):(\d+)\)?$/.exec(frame);
  if (parts === null) {
    // Something without a position — `<anonymous>`, or a frame shape this
    // engine spells differently. Left as it came.
    return frame;
  }
  const [, name, path, line, column] = parts as unknown as [string, string, string, string, string];
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const tail = path.slice(cut + 1);
  // A development server appends `?v=…` to the URL it serves, which is noise
  // in a stack and different on every restart.
  const query = tail.indexOf('?');
  const file = (query === -1 ? tail : tail.slice(0, query)).trim();
  const where = `${file}:${line}:${column}`;
  return name.trim() === '' ? where : `${name.trim()} (${where})`;
}

/** Only the position of a frame: `main.tsx:12:11`, without who was running. */
export function position(frame: string): string {
  const inside = /\(([^()]+)\)\s*$/.exec(frame);
  return (inside === null ? frame : (inside[1] as string)).trim();
}

/**
 * Anything that carries a position, shown at once and corrected after.
 *
 * Two things here name a place: a stack frame, and a cell the compiler did not
 * name, which is labelled by where it was created. Both come from the engine
 * and both say where the *compiled* module has it, which is not a line anyone
 * wrote. Resolving needs the module and its map, so it cannot happen while the
 * write does — the position appears immediately and is replaced when the
 * answer arrives.
 *
 * A name with no position in it — `h1.text`, or `v (main.tsx:9)`, which the
 * compiler took from the source in the first place — passes through untouched.
 */
export function located(
  tag: string,
  className: string,
  name: string,
  format: (shown: string) => string = (shown) => shown,
): HTMLElement {
  const element = text(tag, className, format(shorten(name)));
  void original(name).then((resolved) => {
    element.textContent = format(shorten(resolved));
  });
  return element;
}

/** Keeps a detail in view while the list above it scrolls. */
export function pin(detail: HTMLElement): HTMLElement {
  detail.classList.add('pinned');
  return detail;
}
