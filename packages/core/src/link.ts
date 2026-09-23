/**
 * One dependency edge (ADR-0002).
 *
 * Its own file because it is a data structure rather than a step of the
 * algorithm: `core.ts` is what walks these, and nothing here knows how.
 */

import type { Cell } from './cell.js';

/** One dependency edge, shared by the source's subscriber list and the
 *  subscriber's dependency list. */
export class Link {
  declare dep: Cell;
  declare sub: Cell;
  declare prevDep: Link | undefined;
  declare nextDep: Link | undefined;
  declare prevSub: Link | undefined;
  declare nextSub: Link | undefined;

  // One allocation per dependency edge (ADR-0002). An options object would be
  // a second one, on the path that exists to allocate nothing in the common
  // case — see docs/architecture/code-rules.md §5.
  // eslint-disable-next-line max-params -- measured hot path; see above
  constructor(
    dep: Cell,
    sub: Cell,
    prevDep: Link | undefined,
    nextDep: Link | undefined,
    prevSub: Link | undefined,
  ) {
    this.dep = dep;
    this.sub = sub;
    this.prevDep = prevDep;
    this.nextDep = nextDep;
    this.prevSub = prevSub;
    this.nextSub = undefined;
  }
}
