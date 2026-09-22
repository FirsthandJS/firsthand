/**
 * The panel: the questions, answered by pointing rather than by typing.
 *
 * A console API is exact and slow. You have to know the function, know the
 * selector, and read a tree as text. The common case is "that element is
 * wrong" — and for that, pointing at it should be the whole interaction.
 *
 * This module is the shell: the shadow root, the header, the picker, and which
 * tab is showing. What each tab draws is in `views.ts`, which knows nothing
 * about any of that.
 */
// From the query side rather than from the entry module: the entry module is
// what loads this one, on demand, and importing it back would be a cycle.
import { setWatcher as watch } from './record.js';
import { OUTLINE, OUTLINE_STYLE, STYLE } from './style.js';
import { hasChosen, renderGraph, renderQueries, renderTimeline, resetViews } from './views.js';
import { button, text } from './widgets.js';

let host: HTMLElement | null = null;
/** Held rather than looked up: `open` built them, so they exist while it is open. */
let parts: {
  body: HTMLElement;
  pick: Element;
  graphTab: Element;
  queryTab: Element;
  timelineTab: Element;
} | null = null;
let selected: Node | null = null;
let picking = false;
let tab: 'graph' | 'queries' | 'timeline' = 'graph';
/** A pending redraw, so a burst of updates costs one frame rather than many. */
let frame: number | null = null;

function render(): void {
  if (parts === null) {
    return;
  }
  const { body, pick, graphTab, queryTab, timelineTab } = parts;
  // Where the list was, so a redraw does not throw the reader back to the top.
  const offset = body.querySelector('.scroll')?.scrollTop ?? 0;
  graphTab.setAttribute('aria-pressed', String(tab === 'graph'));
  queryTab.setAttribute('aria-pressed', String(tab === 'queries'));
  timelineTab.setAttribute('aria-pressed', String(tab === 'timeline'));
  pick.setAttribute('aria-pressed', String(picking));
  body.textContent = '';
  if (tab === 'graph') {
    renderGraph(body, selected);
  } else if (tab === 'queries') {
    renderQueries(body);
  } else {
    renderTimeline(body, render);
  }
  const list = body.querySelector('.scroll');
  if (list !== null) {
    list.scrollTop = offset;
  }
}

function onPick(event: MouseEvent): void {
  if (!picking || host === null || event.composedPath().includes(host)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  selected = event.target as Node;
  picking = false;
  document.querySelector(`.${OUTLINE}`)?.classList.remove(OUTLINE);
  render();
}

function onHover(event: MouseEvent): void {
  if (!picking) {
    return;
  }
  document.querySelector(`.${OUTLINE}`)?.classList.remove(OUTLINE);
  const target = event.target as Element | null;
  if (target !== null && target !== host) {
    target.classList.add(OUTLINE);
  }
}

/**
 * Opens the panel.
 *
 * In a shadow root with `all: initial`, so the page's stylesheet cannot reach
 * it and its own cannot reach the page. An inspector that changes what it is
 * inspecting is worse than no inspector.
 */
export function open(): void {
  if (host !== null) {
    return;
  }
  host = document.createElement('div');
  host.setAttribute('data-firsthand-devtools', '');
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;
  const outline = document.createElement('style');
  outline.textContent = OUTLINE_STYLE;
  document.head.append(outline);

  const panel = document.createElement('div');
  panel.className = 'panel';
  const body = document.createElement('div');
  body.className = 'body';
  panel.append(header(body), body);
  root.append(style, panel);
  document.body.append(host);

  document.addEventListener('click', onPick, true);
  document.addEventListener('mouseover', onHover, true);
  // Redrawn when the graph settles, not on a timer: a panel showing a value
  // the page has already moved past is worse than one that is plainly idle.
  watch(settled);
  render();
}

/**
 * The header, and the record of what is in it.
 *
 * Built rather than written as HTML: an inspector that assigns `innerHTML`
 * inside the page it is inspecting is a bad example even when the string is
 * its own.
 */
function header(body: HTMLElement): HTMLElement {
  const element = document.createElement('header');
  element.append(text('strong', '', 'Firsthand'));

  const pick = button('Pick', () => {
    picking = !picking;
    render();
  });
  pick.dataset['pick'] = '';

  const graphTab = tabButton('graph', 'Graph');
  const queryTab = tabButton('queries', 'Queries');
  const timelineTab = tabButton('timeline', 'Timeline');

  const closer = button('×', close);
  closer.setAttribute('aria-label', 'Close');

  element.append(pick, graphTab, queryTab, timelineTab, closer);
  parts = { body, pick, graphTab, queryTab, timelineTab };
  return element;
}

/** One tab of the header, which selects itself and redraws. */
function tabButton(name: 'graph' | 'queries' | 'timeline', label: string): HTMLButtonElement {
  const element = button(label, () => {
    tab = name;
    render();
  });
  element.dataset['tab'] = name;
  return element;
}

/**
 * The graph has settled, so what is on the screen may be out of date.
 *
 * Nothing moves while an entry is open. A list that re-sorts under the pointer
 * twice a second is unusable precisely when something has been found worth
 * looking at.
 */
function settled(): void {
  if (hasChosen() || frame !== null) {
    return;
  }
  frame = requestAnimationFrame(() => {
    frame = null;
    render();
  });
}

/** Closes the panel and removes everything it added to the page. */
export function close(): void {
  watch(null);
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  document.removeEventListener('click', onPick, true);
  document.removeEventListener('mouseover', onHover, true);
  document.querySelector(`.${OUTLINE}`)?.classList.remove(OUTLINE);
  host?.remove();
  host = null;
  parts = null;
  picking = false;
  selected = null;
  tab = 'graph';
  resetViews();
}

/** Opens the panel, or closes it if it is already open. */
export function toggle(): void {
  if (host === null) {
    open();
  } else {
    close();
  }
}

/** Shows the panel for a node the caller already has. */
export function show(node: Node): void {
  open();
  selected = node;
  tab = 'graph';
  render();
}

/** Redraws, for a caller that changed something and wants to see it. */
export function refresh(): void {
  render();
}
