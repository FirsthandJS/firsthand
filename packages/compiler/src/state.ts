/**
 * What one module's compilation knows about itself.
 *
 * Everything here is per-file and lives for one `transform()`. The two import
 * helpers are the only way a pass names something from the runtime, which is
 * what keeps the import list at the top of the output correct without anyone
 * maintaining it: asking for a name is what adds it.
 */

import type { PluginPass } from '@babel/core';

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

const RUNTIME = '@firsthandjs/dom/internal';
const SERVER_RUNTIME = '@firsthandjs/server/internal';

export type FirsthandState = {
  imports: Map<string, t.Identifier>;
  templates: t.VariableDeclarator[];
  counter: number;
  moduleId: string;
  /** Module-level functions markup was compiled into, in source order. */
  views: Map<string, t.Identifier>;
  /** Every function markup was written inside, for resolving tags locally. */
  viewNodes: Set<t.Node>;
  /** Whether this module is being compiled for a server render. */
  ssr: boolean;
  /** Whether this module's output has to be able to adopt server markup. */
  hydratable: boolean;
  /** Functions that run again as a whole, and where each keeps its sites. */
  runs: Map<t.Node, RunContext>;
};

/**
 * What a re-running function needs in order to keep its DOM.
 *
 * `store` is an array declared once per instance — in the setup, which runs
 * once — and every site inside the run takes a numbered place in it. The index
 * is fixed at compile time, so a site inside an `if` keeps its own place
 * whether or not the branch was taken: nothing depends on the order the run
 * happens to reach things in, which is the rule React needs for hooks and this
 * does not.
 */
export type RunContext = {
  /** The function whose body re-runs. Bindings inside it belong to one run. */
  node: t.Node;
  store: t.Identifier;
  next: () => number;
};

declare module '@babel/core' {
  interface PluginPass {
    firsthand: FirsthandState;
  }
}

export type State = PluginPass;

export type Build = {
  html: string[];
  /** Navigation to the nodes a template's parts need. Runs every time. */
  statements: t.Statement[];
  /** Work done when the site is made: parts, listeners, refs. */
  once: t.Statement[];
  /** Writes the run performs into a site it already made. */
  each: t.Statement[];
  run: RunContext | null;
  /** Where to resolve names from, when deciding what belongs to the run. */
  at: NodePath;
  next: () => t.Identifier;
  name: (prefix: string) => t.Identifier;
};

export function pushOnce(build: Build, statement: t.Statement): void {
  build.once.push(statement);
}

export function pushEach(build: Build, statement: t.Statement): void {
  build.each.push(statement);
}

export function runtime(state: State, name: string, source?: string): t.Identifier {
  return runtimeFrom(state, name, source ?? (state.firsthand.ssr ? SERVER_RUNTIME : RUNTIME));
}

export function runtimeFrom(state: State, name: string, source: string): t.Identifier {
  const key = `${source}#${name}`;
  let local = state.firsthand.imports.get(key);
  if (local === undefined) {
    local = t.identifier(`_$${name}`);
    state.firsthand.imports.set(key, local);
  }
  return t.cloneNode(local);
}

/**
 * The element an attribute or a child is being emitted onto.
 *
 * Four things that always travel together — where the output goes, which
 * variable holds the node, the module's state, and the tag, which decides
 * whether a name is a DOM property. `deferred` is the work that cannot happen
 * until the opening tag is closed: a listener needs the node, and the node does
 * not exist while its attributes are still being written into the HTML.
 */
export type Host = {
  build: Build;
  self: t.Identifier;
  state: State;
  deferred: (() => void)[];
  tag: string;
};
