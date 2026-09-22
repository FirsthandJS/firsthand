/**
 * Devtools for Firsthand (ADR-0020).
 *
 * The reactive graph is not something this package records. It is already
 * there, because propagation and disposal need it: every cell carries its
 * dependencies and its subscribers as linked lists, and every owner carries
 * its children and its cells. This package attaches names to those nodes and
 * reads the structure when asked.
 *
 * Nothing here runs unless `attach()` is called, and none of it exists in a
 * production build of the framework: the hooks that feed it live in modules
 * the build replaces with empty functions.
 *
 * | Module        | What it does                                      |
 * | ------------- | ------------------------------------------------- |
 * | `recorded.ts` | what has been observed, and nothing that writes it |
 * | `record.ts`   | the hook the core calls — the only writer          |
 * | `names.ts`    | what to call a cell                                |
 * | `queries.ts`  | the questions, which is all the panel needs        |
 * | `panel.ts`    | the answers, by pointing rather than by typing     |
 *
 * This module is the entry point and nothing else: it wires the console API
 * and the shortcut, and it is the only module that knows the panel exists.
 * That is what lets the panel be loaded on demand — a module that imported it
 * back would be a cycle, and a cycle would defeat the splitting.
 */

import { install, uninstall } from './record.js';

import { causeOf, cells, chain, inspect, queries, stack, timeline } from './queries.js';

export { cells, inspect, chain, path, causeOf, queries, stack, timeline } from './queries.js';

export type { NodeKind, Update, QueryEvent, GraphNode } from './types.js';

/**
 * Registers something to be told when the graph has settled.
 *
 * Used by the panel to redraw itself. Exported because the panel is a separate
 * module, not because an application should need it — and re-exported rather
 * than wrapped so that the panel and an outside caller reach the same function.
 * A wrapper here would be a line only the panel could have covered, and the
 * panel does not come through this module.
 */
export { setWatcher as watch } from './record.js';

/** The shortcut listener, kept so `detach` can take it away again. */
let shortcut: ((event: KeyboardEvent) => void) | null = null;

/** What `attach()` puts on `globalThis` for the browser console to use. */
export type Console = {
  chain: typeof chain;
  inspect: typeof inspect;
  causeOf: typeof causeOf;
  stack: typeof stack;
  timeline: typeof timeline;
  cells: typeof cells;
  queries: typeof queries;
  detach: typeof detach;
  /** Opens the panel, or shows it for a node you already have. */
  panel: (node?: Node) => void;
};

/**
 * Starts recording.
 *
 * Call it before the application creates anything — an import at the top of
 * the entry module is the usual place — because a cell created earlier has no
 * name to record. It stays in the graph; it is simply labelled by its
 * creation site rather than by what it is called.
 */
export function attach(): void {
  if (!install()) {
    return;
  }
  // A tool that gives no sign of itself is a tool nobody opens. One line, once,
  // saying the two ways in — and a shortcut, because reaching for the console
  // to look at the page is the wrong way round.
  shortcut = (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      // The shortcut toggles: the same keys that opened it put it away again.
      // `__FIRSTHAND__.panel()` opens, because asking for it twice from the
      // console should not be how you close it.
      void togglePanel();
    }
  };
  globalThis.addEventListener('keydown', shortcut);
  console.info(
    '[firsthand] devtools attached — press Ctrl+Shift+F for the panel, ' +
      'or call __FIRSTHAND__.panel()',
  );
  // The console cannot import. A bare specifier has no resolver there, and in
  // a bundled application the module is inside the bundle — so the API is put
  // where the console can reach it, spelled to pair with the element the
  // Elements panel has selected:
  //
  //   __FIRSTHAND__.chain($0)
  (globalThis as { __FIRSTHAND__?: Console }).__FIRSTHAND__ = {
    chain,
    inspect,
    causeOf,
    stack,
    timeline,
    cells,
    queries,
    detach,
    panel: (node?: Node) => {
      void openPanel(node);
    },
  };
}

/**
 * Loaded when it is opened, not before: the panel is the larger half of this
 * package and most sessions never open it.
 */
async function openPanel(node?: Node): Promise<void> {
  const module = await import('./panel.js');
  if (node === undefined) {
    module.open();
  } else {
    module.show(node);
  }
}

/** The same, for the shortcut, which puts the panel away again. */
async function togglePanel(): Promise<void> {
  const module = await import('./panel.js');
  module.toggle();
}

/** Stops recording and forgets everything. Mostly for tests. */
export function detach(): void {
  uninstall();
  delete (globalThis as { __FIRSTHAND__?: Console }).__FIRSTHAND__;
  if (shortcut !== null) {
    globalThis.removeEventListener('keydown', shortcut);
    shortcut = null;
  }
}
