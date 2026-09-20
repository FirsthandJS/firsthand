/**
 * The panel: the questions, answered by pointing rather than by typing.
 *
 * A console API is exact and slow. You have to know the function, know the
 * selector, and read a tree as text. The common case is "that element is
 * wrong" — and for that, pointing at it should be the whole interaction.
 *
 * It is plain DOM, deliberately: this runs inside the page it is inspecting,
 * so it must not create parts, own scopes or appear in the graph it is showing.
 * Rendering it with the framework would put the inspector into its own results.
 */
import {
  causeOf,
  inspect,
  path,
  queries,
  stack,
  timeline,
  watch,
  type GraphNode,
  type Update,
} from './index.js';

const STYLE = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 460px; max-height: 78vh; display: flex; flex-direction: column;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e6e6e6; background: #1c1c1f; border: 1px solid #3a3a40;
  border-radius: 10px; box-shadow: 0 10px 40px rgb(0 0 0 / 0.45);
}
header { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid #3a3a40; }
header strong { font-weight: 600; letter-spacing: 0.02em; flex: 1; }
button { font: inherit; color: inherit; background: #2a2a30; border: 1px solid #45454d;
  border-radius: 5px; padding: 3px 8px; cursor: pointer; }
button:hover { background: #34343c; }
button[aria-pressed='true'] { background: #3d5afe; border-color: #3d5afe; color: #fff; }
.body { overflow: auto; padding: 12px; }
.empty { color: #8a8a94; }
.hint { color: #7c7c88; margin: 14px 0 6px; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.1em; }
.hint:first-child { margin-top: 0; }
.section + .section { margin-top: 2px; }
.stack { margin: 4px 0 0; }
.stack div { color: #9a9aa6; padding-left: 10px; border-left: 1px solid #3a3a40; }
.stack div:first-child { color: #e6e6e6; }
.filters { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.filters .chip { background: #2a2a30; border: 1px solid #45454d; border-radius: 999px;
  padding: 1px 9px; cursor: pointer; color: #9ecbff; }
.filters .chip[aria-pressed='true'] { background: #3d5afe; border-color: #3d5afe; color: #fff; }
.count { color: #7c7c88; }

/* The path, as boxes and arrows rather than as three lines of text. */
.flow { display: flex; flex-direction: column; align-items: stretch; gap: 0; }
.box { border: 1px solid #45454d; border-radius: 7px; padding: 6px 9px; background: #232329;
  display: flex; align-items: baseline; gap: 8px; }
.box .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
  padding: 1px 5px; border-radius: 4px; background: #34343c; color: #b9b9c4; }
.box .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box .val { color: #c3e88d; }
.box.signal { border-color: #3d5afe; }
.box.signal .tag { background: #23306b; color: #b6c4ff; }
.box.computed { border-color: #c792ea; }
.box.computed .tag { background: #3a2b47; color: #e6c8ff; }
.box.part { border-color: #ffcb6b; }
.box.part .tag { background: #4a3a1c; color: #ffdfa1; }
.box.trigger { box-shadow: 0 0 0 2px #3d5afe66; }
.arrow { align-self: center; color: #6a6a76; font-size: 14px; line-height: 1; padding: 3px 0; }

/* The component stack, as crumbs. */
.crumbs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
.crumb { background: #2a2a30; border: 1px solid #45454d; border-radius: 999px;
  padding: 1px 8px; color: #c792ea; }
.crumb + .crumb::before { content: '›'; color: #8a8a94; margin-right: 6px; margin-left: -4px; }

/* The timeline: one row per update, a bar for how much it woke. */
.track { display: flex; flex-direction: column; gap: 4px; }
.tick { display: grid; grid-template-columns: 52px 1fr auto; gap: 8px; align-items: center;
  padding: 3px 4px; border-radius: 5px; cursor: pointer; }
.tick:hover { background: #26262c; }
.tick[aria-selected='true'] { background: #23306b; }
.tick .when { color: #8a8a94; text-align: right; }
.tick .who { color: #9ecbff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tick .bar { height: 8px; border-radius: 4px; background: #3d5afe; min-width: 4px; }
.tick .bar.none { background: #4a4a54; }
.detail { margin-top: 8px; border-top: 1px solid #3a3a40; padding-top: 8px; }
.detail .ran { color: #ffdfa1; }
.cause { color: #ffcb6b; margin: 10px 0 0; }
.event { display: grid; grid-template-columns: 84px 1fr; gap: 8px; padding: 2px 0; }
.event .created { color: #c3e88d; }
.event .invalidated { color: #ffcb6b; }
.event .dropped { color: #f07178; }
.event .tags { color: #9ecbff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** The element the picker is over, highlighted without touching its styles. */
const OUTLINE = 'firsthand-devtools-outline';

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
/** The update the timeline is showing in detail. */
let chosen: Update | null = null;
/** A source to narrow the timeline to, or `null` for all of them. */
let only: string | null = null;

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  element.setAttribute('aria-pressed', 'false');
  element.addEventListener('click', onClick);
  return element;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/** One node of the path, as a box that says what it is and what it holds. */
function boxFor(node: GraphNode, trigger: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = `box ${node.kind}${trigger ? ' trigger' : ''}`;
  box.append(text('span', 'tag', node.kind));
  box.append(text('span', 'label', node.name));
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

function renderGraph(body: HTMLElement): void {
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
    body.append(track(recent));
  }
  if (chosen !== null) {
    body.append(detailsOf(chosen));
  }
}

/** The updates as rows: when, what was written, and how much it woke. */
function track(updates: Update[]): HTMLElement {
  const most = Math.max(1, ...updates.map((update) => update.ran.length));
  const list = document.createElement('div');
  list.className = 'track';
  for (const update of updates) {
    const row = document.createElement('div');
    row.className = 'tick';
    row.setAttribute('aria-selected', String(update === chosen));
    row.append(text('span', 'when', `${String(update.at)}ms`));
    row.append(text('span', 'who', update.source));
    const bar = document.createElement('span');
    bar.className = update.ran.length === 0 ? 'bar none' : 'bar';
    // Width by how many parts it woke, so a glance separates the write that
    // rebuilt half the page from the one that woke nothing at all.
    bar.style.width = `${String(Math.round((update.ran.length / most) * 60) + 6)}px`;
    row.append(bar);
    row.addEventListener('click', () => {
      select(update);
    });
    list.append(row);
  }
  return list;
}

/** Who wrote it, what it woke, and where the write came from. */
function detailsOf(update: Update): HTMLElement {
  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.append(text('p', 'hint', `${update.source} woke ${String(update.ran.length)}`));
  for (const name of update.ran) {
    detail.append(text('div', 'ran', name));
  }
  if (update.stack.length > 0) {
    detail.append(text('p', 'hint', 'Written from'));
    const frames = document.createElement('div');
    frames.className = 'stack';
    for (const frame of update.stack) {
      frames.append(text('div', '', frame));
    }
    detail.append(frames);
  }
  return detail;
}

function select(update: Update): void {
  chosen = chosen === update ? null : update;
  render();
}

function renderTimeline(body: HTMLElement): void {
  const updates = timeline();
  if (updates.length === 0) {
    body.append(text('p', 'empty', 'Nothing has changed yet.'));
    return;
  }
  // One chip per source that has written, so a busy page can be narrowed to
  // the one signal being argued about.
  const sources = [...new Set(updates.map((update) => update.source))];
  if (sources.length > 1) {
    const filters = document.createElement('div');
    filters.className = 'filters';
    for (const source of sources) {
      const chip = text('span', 'chip', source);
      chip.setAttribute('aria-pressed', String(only === source));
      chip.addEventListener('click', () => {
        only = only === source ? null : source;
        chosen = null;
        render();
      });
      filters.append(chip);
    }
    body.append(filters);
  }

  const shown = only === null ? updates : updates.filter((update) => update.source === only);
  body.append(text('p', 'hint', `${String(shown.length)} of ${String(updates.length)} updates`));
  body.append(track([...shown].reverse()));
  if (chosen !== null) {
    body.append(detailsOf(chosen));
  }
}

function renderQueries(body: HTMLElement): void {
  const events = queries();
  if (events.length === 0) {
    body.append(text('p', 'empty', 'The query cache has done nothing yet.'));
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

function render(): void {
  if (parts === null) {
    return;
  }
  const { body, pick, graphTab, queryTab, timelineTab } = parts;
  graphTab.setAttribute('aria-pressed', String(tab === 'graph'));
  queryTab.setAttribute('aria-pressed', String(tab === 'queries'));
  timelineTab.setAttribute('aria-pressed', String(tab === 'timeline'));
  pick.setAttribute('aria-pressed', String(picking));
  body.textContent = '';
  if (tab === 'graph') {
    renderGraph(body);
  } else if (tab === 'queries') {
    renderQueries(body);
  } else {
    renderTimeline(body);
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
  outline.textContent = `.${OUTLINE} { outline: 2px solid #3d5afe !important; outline-offset: 1px; }`;
  document.head.append(outline);

  const panel = document.createElement('div');
  panel.className = 'panel';

  // Built rather than written as HTML: an inspector that assigns `innerHTML`
  // inside the page it is inspecting is a bad example even when the string is
  // its own.
  const header = document.createElement('header');
  header.append(text('strong', '', 'Firsthand'));

  const pick = button('Pick', () => {
    picking = !picking;
    render();
  });
  pick.dataset['pick'] = '';

  const graphTab = button('Graph', () => {
    tab = 'graph';
    render();
  });
  graphTab.dataset['tab'] = 'graph';

  const queryTab = button('Queries', () => {
    tab = 'queries';
    render();
  });
  queryTab.dataset['tab'] = 'queries';

  const timelineTab = button('Timeline', () => {
    tab = 'timeline';
    render();
  });
  timelineTab.dataset['tab'] = 'timeline';

  const closer = button('×', close);
  closer.setAttribute('aria-label', 'Close');

  header.append(pick, graphTab, queryTab, timelineTab, closer);
  const body = document.createElement('div');
  body.className = 'body';
  panel.append(header, body);
  root.append(style, panel);
  document.body.append(host);
  parts = { body, pick, graphTab, queryTab, timelineTab };

  document.addEventListener('click', onPick, true);
  document.addEventListener('mouseover', onHover, true);
  // Redrawn when the graph settles, not on a timer: a panel showing a value
  // the page has already moved past is worse than one that is plainly idle.
  watch(() => {
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        frame = null;
        render();
      });
    }
  });
  render();
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
  chosen = null;
  only = null;
  picking = false;
  selected = null;
  tab = 'graph';
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
