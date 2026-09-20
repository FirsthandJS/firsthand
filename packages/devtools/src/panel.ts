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
  chain,
  inspect,
  queries,
  stack,
  timeline,
  watch,
  type GraphNode,
} from './index.js';

const STYLE = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 420px; max-height: 70vh; display: flex; flex-direction: column;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e6e6e6; background: #1c1c1f; border: 1px solid #3a3a40;
  border-radius: 8px; box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
}
header { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid #3a3a40; }
header strong { font-weight: 600; letter-spacing: 0.02em; flex: 1; }
button { font: inherit; color: inherit; background: #2a2a30; border: 1px solid #45454d;
  border-radius: 5px; padding: 3px 8px; cursor: pointer; }
button:hover { background: #34343c; }
button[aria-pressed='true'] { background: #3d5afe; border-color: #3d5afe; color: #fff; }
.body { overflow: auto; padding: 10px; }
.empty { color: #8a8a94; }
.chain { margin: 0 0 10px; white-space: pre; }
.chain .arrow { color: #8a8a94; }
.node { padding-left: 14px; border-left: 1px solid #3a3a40; margin-left: 4px; }
.name { color: #9ecbff; }
.kind { color: #8a8a94; }
.value { color: #c3e88d; }
.cause { color: #ffcb6b; }
.event { display: flex; gap: 6px; }
.event .created { color: #c3e88d; }
.event .invalidated { color: #ffcb6b; }
.event .dropped { color: #f07178; }
.hint { color: #8a8a94; margin: 8px 0 2px; }
.stack { color: #c792ea; margin: 0 0 8px; }
.update { color: #e6e6e6; }
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

/** One node and its dependencies, indented. */
function draw(node: GraphNode, into: HTMLElement, depth: number): void {
  const line = document.createElement('div');
  line.append(text('span', 'name', node.name));
  line.append(text('span', 'kind', ` ${node.kind}`));
  const value = node.value;
  // Primitives only. An object's default stringification is `[object Object]`,
  // which tells a reader nothing and takes the place of something that would.
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    line.append(text('span', 'value', ` = ${JSON.stringify(value)}`));
  }
  into.append(line);
  if (depth > 6 || node.dependencies.length === 0) {
    return;
  }
  const nested = document.createElement('div');
  nested.className = 'node';
  for (const dependency of node.dependencies) {
    draw(dependency, nested, depth + 1);
  }
  into.append(nested);
}

function renderGraph(body: HTMLElement): void {
  if (selected === null) {
    body.append(
      text('p', 'empty', 'Nothing selected.'),
      text('p', 'hint', 'Press “Pick” and click an element, or right-click → Inspect.'),
    );
    return;
  }
  const where = stack(selected);
  if (where.length > 0) {
    body.append(text('p', 'stack', where.join(' › ')));
  }
  const drawn = chain(selected);
  const lines = drawn.split('\n');
  const block = document.createElement('pre');
  block.className = 'chain';
  for (const [at, line] of lines.entries()) {
    block.append(text('span', line.trim() === '↓' ? 'arrow' : 'name', line));
    if (at < lines.length - 1) {
      block.append(document.createTextNode('\n'));
    }
  }
  body.append(block);

  const why = causeOf(selected);
  body.append(
    text(
      'p',
      'cause',
      why === null ? 'Has not run since anything changed.' : `Last ran because: ${why}`,
    ),
  );

  for (const part of inspect(selected)) {
    draw(part, body, 0);
  }

  const recent = timeline(selected).slice(-5).reverse();
  if (recent.length > 0) {
    body.append(text('p', 'hint', 'Last updates of this node'));
    for (const update of recent) {
      body.append(text('div', 'update', `${String(update.at)}ms  ${update.source}`));
    }
  }
}

function renderTimeline(body: HTMLElement): void {
  const updates = timeline();
  if (updates.length === 0) {
    body.append(text('p', 'empty', 'Nothing has changed yet.'));
    return;
  }
  for (const update of [...updates].reverse()) {
    const row = document.createElement('div');
    row.className = 'update';
    row.append(text('span', 'kind', `${String(update.at)}ms`));
    row.append(text('span', 'cause', ` ${update.source}`));
    row.append(text('span', 'kind', ` → ${String(update.ran.length)}`));
    body.append(row);
    if (update.ran.length > 0) {
      const ran = document.createElement('div');
      ran.className = 'node';
      for (const name of update.ran) {
        ran.append(text('div', 'name', name));
      }
      body.append(ran);
    }
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
    row.append(text('span', 'name', event.tags.join(', ')));
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
  picking = false;
  selected = null;
  tab = 'graph';
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
