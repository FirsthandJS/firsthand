/**
 * The three tabs, and the one piece of state they share.
 *
 * A view knows how to draw an answer and nothing about the panel around it:
 * where a click has to redraw, the panel passes a function in. That is what
 * lets `panel.ts` own the shell without either module importing the other.
 *
 * `chosen` is shared because both the graph and the timeline show the update
 * list, and an entry opened in one is the same entry in the other.
 */

import { causeOf, inspect, path, queries, stack, timeline } from './queries.js';

import type { GraphNode, Update } from './types.js';

import { button, located, pin, position, text } from './widgets.js';

/** The update the timeline is showing in detail. */
let chosen: Update | null = null;
/** The drawn rows, so selecting one can mark it without rebuilding the list. */
const rows = new Map<HTMLElement, Update>();
/** A source to narrow the timeline to, or `null` for all of them. */
let only: string | null = null;

/** Whether an entry is open, which is when a redraw would move it. */
export function hasChosen(): boolean {
  return chosen !== null;
}

/** Forgets what was open and what was filtered. The panel calls it on close. */
export function resetViews(): void {
  chosen = null;
  only = null;
  rows.clear();
}

/** One node of the path, as a box that says what it is and what it holds. */
function boxFor(node: GraphNode, trigger: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = `box ${node.kind}${trigger ? ' trigger' : ''}`;
  box.append(text('span', 'tag', node.kind));
  box.append(located('span', 'label', node.name));
  const value = node.value;
  // Primitives only: an object's default stringification says nothing and
  // takes the place of something that would.
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    box.append(text('span', 'val', JSON.stringify(value)));
  }
  return box;
}

/**
 * Draws the path from the sources down to the node, as boxes and arrows.
 *
 * Top to bottom, because that is the direction the value travels. The source
 * is marked when it is the one that caused the last run, which is the whole
 * question "what triggers this" asked in one glance.
 */
function drawFlow(part: GraphNode, cause: string | null, into: HTMLElement): void {
  const flowPath = path(part);
  const flow = document.createElement('div');
  flow.className = 'flow';
  for (const [at, node] of flowPath.entries()) {
    flow.append(boxFor(node, node.name === cause));
    if (at < flowPath.length - 1) {
      flow.append(text('div', 'arrow', '↓'));
    }
  }
  into.append(flow);
}

export function renderGraph(host: HTMLElement, selected: Node | null): void {
  const body = document.createElement('div');
  body.className = 'scroll';
  host.append(body);
  if (selected === null) {
    body.append(
      text('p', 'empty', 'Nothing selected.'),
      text('p', 'hint', 'Press “Pick” and click an element.'),
    );
    return;
  }

  const where = stack(selected);
  if (where.length > 0) {
    body.append(text('p', 'hint', 'Component'));
    const crumbs = document.createElement('div');
    crumbs.className = 'crumbs';
    for (const name of where) {
      crumbs.append(text('span', 'crumb', name));
    }
    body.append(crumbs);
  }

  const parts = inspect(selected);
  if (parts.length === 0) {
    body.append(text('p', 'empty', 'Nothing reactive writes this node.'));
    return;
  }

  const why = causeOf(selected);
  body.append(text('p', 'hint', 'Path'));
  for (const part of parts) {
    drawFlow(part, why, body);
  }

  body.append(
    text(
      'p',
      'cause',
      why === null ? 'Has not run since anything changed.' : `Triggered by ${why}`,
    ),
  );

  const recent = timeline(selected).slice(-6).reverse();
  if (recent.length > 0) {
    body.append(text('p', 'hint', `Last ${String(recent.length)} updates`));
    body.append(track(recent, host));
  }
  if (chosen !== null) {
    // Beside the scrolling list, not inside it — the same place the timeline
    // puts it, and for the same reason.
    host.append(pin(detailsOf(chosen, host)));
  }
}

/** The updates as rows: when, what was written, and how much it woke. */
function track(updates: Update[], container: HTMLElement): HTMLElement {
  rows.clear();
  const most = Math.max(1, ...updates.map((update) => update.ran.length));
  const list = document.createElement('div');
  list.className = 'track';
  for (const update of updates) {
    const row = document.createElement('div');
    row.className = 'tick';
    row.setAttribute('aria-selected', String(update === chosen));
    rows.set(row, update);
    row.append(text('span', 'when', `${String(update.at)}ms`));
    row.append(located('span', 'who', update.source));
    const bar = document.createElement('span');
    bar.className = update.ran.length === 0 ? 'bar none' : 'bar';
    // Width by how many parts it woke, so a glance separates the write that
    // rebuilt half the page from the one that woke nothing at all.
    bar.style.width = `${String(Math.round((update.ran.length / most) * 60) + 6)}px`;
    // A bar with no scale beside it is a shape, not a number. Said outright,
    // so the width does not have to be guessed at.
    bar.title = `woke ${String(update.ran.length)} of ${String(most)}`;
    row.append(bar);
    // Where the write came from, not where the signal was declared: the name
    // beside it answers "what changed", and this answers "from where", which
    // is the pair of questions a timeline is opened with.
    const from = update.stack[0];
    if (from !== undefined) {
      row.append(located('span', 'where', from, position));
    }
    row.addEventListener('click', () => {
      select(update, container);
    });
    list.append(row);
  }
  return list;
}

/** Who wrote it, what it woke, and where the write came from. */
function detailsOf(update: Update, container: HTMLElement): HTMLElement {
  const detail = document.createElement('div');
  detail.className = 'detail';
  const head = document.createElement('div');
  head.className = 'detail-head';
  head.append(
    located('p', 'hint', update.source, (shown) => `${shown} woke ${String(update.ran.length)}`),
  );
  // The update this detail was built for, so closing is the same toggle the
  // row performs — and needs no check for what is open.
  const closer = button('×', () => {
    select(update, container);
  });
  closer.setAttribute('aria-label', 'Close detail');
  head.append(closer);
  detail.append(head);
  for (const name of update.ran) {
    detail.append(located('div', 'ran', name));
  }
  if (update.stack.length > 0) {
    detail.append(text('p', 'hint', 'Written from'));
    const frames = document.createElement('div');
    frames.className = 'stack';
    for (const frame of update.stack) {
      frames.append(located('div', '', frame));
    }
    detail.append(frames);
  }
  return detail;
}

/**
 * Opens or closes an entry, without touching the list.
 *
 * Re-rendering here would rebuild the list from everything that has arrived
 * since it was drawn — and with the newest first, that pushes the row being
 * clicked down and out from under the pointer. Which is exactly what freezing
 * the redraw was meant to prevent, undone by the click that starts it.
 */
function select(update: Update, container: HTMLElement): void {
  chosen = chosen === update ? null : update;
  for (const [row, entry] of rows) {
    row.setAttribute('aria-selected', String(entry === chosen));
  }
  container.querySelector('.pinned')?.remove();
  if (chosen !== null) {
    container.append(pin(detailsOf(chosen, container)));
  }
}

/**
 * Every update, with a chip per source to narrow it.
 *
 * `redraw` rather than a call back into the panel: a filter changes what the
 * whole panel shows, and the view does not know what else is on the screen.
 */
export function renderTimeline(host: HTMLElement, redraw: () => void): void {
  const updates = timeline();
  if (updates.length === 0) {
    host.append(text('p', 'empty', 'Nothing has changed yet.'));
    return;
  }
  const body = document.createElement('div');
  body.className = 'scroll';
  host.append(body);
  // One chip per source that has written, so a busy page can be narrowed to
  // the one signal being argued about.
  const sources = [...new Set(updates.map((update) => update.source))];
  if (sources.length > 1) {
    const filters = document.createElement('div');
    filters.className = 'filters';
    for (const source of sources) {
      const chip = located('span', 'chip', source);
      chip.setAttribute('aria-pressed', String(only === source));
      chip.addEventListener('click', () => {
        only = only === source ? null : source;
        chosen = null;
        redraw();
      });
      filters.append(chip);
    }
    body.append(filters);
  }

  const shown = only === null ? updates : updates.filter((update) => update.source === only);
  body.append(text('p', 'hint', `${String(shown.length)} of ${String(updates.length)} updates`));
  body.append(track([...shown].reverse(), host));
  if (chosen !== null) {
    host.append(pin(detailsOf(chosen, host)));
  }
}

export function renderQueries(host: HTMLElement): void {
  const body = document.createElement('div');
  body.className = 'scroll';
  host.append(body);
  const events = queries();
  if (events.length === 0) {
    body.append(text('p', 'empty', 'No resource has done anything yet.'));
    return;
  }
  for (const event of [...events].reverse()) {
    const row = document.createElement('div');
    row.className = 'event';
    row.append(text('span', event.event, event.event));
    row.append(text('span', 'tags', event.tags.join(', ')));
    body.append(row);
  }
}
