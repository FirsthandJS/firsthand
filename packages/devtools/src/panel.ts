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
import { original } from './source.js';

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
.body { display: flex; flex-direction: column; overflow: hidden; padding: 12px; min-height: 0; }
/* The list scrolls; the detail stays where it can be read. Without this the
   call stack sits below everything and is only reachable by scrolling past
   the whole log — which is exactly when you least want to. */
/* Two independent scroll areas: the list above, the detail below. Each gets
   its own, because a call stack that can only be reached by scrolling past
   forty rows of log is out of reach exactly when it is wanted. */
.scroll { overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 60px; }
.pinned { flex: 0 1 auto; min-height: 140px; max-height: 65%; overflow-y: auto;
  overflow-x: hidden; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid #3a3a40; }
.detail-head { display: flex; align-items: center; gap: 8px; }
.detail-head .hint { margin: 0; flex: 1; }
.detail-head button { padding: 0 6px; line-height: 1.4; }
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
.tick { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto auto; gap: 8px;
  align-items: center; padding: 3px 4px; border-radius: 5px; cursor: pointer; }
.tick:hover { background: #26262c; }
.tick[aria-selected='true'] { background: #23306b; }
.tick .when { color: #8a8a94; text-align: right; }
.tick .who { color: #9ecbff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tick .where { color: #7c7c88; white-space: nowrap; }
.tick .bar { height: 8px; border-radius: 4px; background: #3d5afe; min-width: 4px; }
.tick .bar.none { background: #4a4a54; }
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
/** The drawn rows, so selecting one can mark it without rebuilding the list. */
const rows = new Map<HTMLElement, Update>();
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

function renderGraph(host: HTMLElement): void {
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
    body.append(track(recent));
  }
  if (chosen !== null) {
    // Beside the scrolling list, not inside it — the same place the timeline
    // puts it, and for the same reason.
    host.append(pin(detailsOf(chosen)));
  }
}

/** The updates as rows: when, what was written, and how much it woke. */
function track(updates: Update[]): HTMLElement {
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
    row.append(bar);
    // Where the write came from, not where the signal was declared: the name
    // beside it answers "what changed", and this answers "from where", which
    // is the pair of questions a timeline is opened with.
    const from = update.stack[0];
    if (from !== undefined) {
      row.append(located('span', 'where', from, position));
    }
    row.addEventListener('click', () => {
      select(update);
    });
    list.append(row);
  }
  return list;
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
function position(frame: string): string {
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
function located(
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
function pin(detail: HTMLElement): HTMLElement {
  detail.classList.add('pinned');
  return detail;
}

/** Who wrote it, what it woke, and where the write came from. */
function detailsOf(update: Update): HTMLElement {
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
    select(update);
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
function select(update: Update): void {
  chosen = chosen === update ? null : update;
  for (const [row, entry] of rows) {
    row.setAttribute('aria-selected', String(entry === chosen));
  }
  const container = parts?.body;
  if (container === undefined) {
    return;
  }
  container.querySelector('.pinned')?.remove();
  if (chosen !== null) {
    container.append(pin(detailsOf(chosen)));
  }
}

function renderTimeline(host: HTMLElement): void {
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
    host.append(pin(detailsOf(chosen)));
  }
}

function renderQueries(host: HTMLElement): void {
  const body = document.createElement('div');
  body.className = 'scroll';
  host.append(body);
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
  // Where the list was, so a redraw does not throw the reader back to the top.
  const offset = body.querySelector('.scroll')?.scrollTop ?? 0;
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
    // Nothing moves while an entry is open. A list that re-sorts under the
    // pointer twice a second is unusable precisely when something has been
    // found worth looking at.
    if (chosen !== null || frame !== null) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      render();
    });
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
