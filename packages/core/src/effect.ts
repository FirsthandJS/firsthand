import {
  Cell,
  createEffectScope,
  defaultEquals,
  disposeCell,
  getOwner,
  own,
  runEffectNow,
} from './core.js';
import { WATCHING } from './flags.js';
import { releaseEffect } from './core.js';
import { devWarn } from './dev.js';
import type { Dispose } from './types.js';

/**
 * An effect body. Returning a function registers it as the cleanup; returning
 * nothing is the common case, which is what the `void` in this union is for.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
type EffectBody = () => void | (() => void);

/**
 * Creates and runs an effect, returning its node.
 *
 * Internal entry point used by the DOM layer, which disposes through the owner
 * tree and therefore never needs the closure that `effect()` allocates. At
 * 100 000 rows that closure would be 100 000 objects for nothing.
 */
export function createEffect(fn: EffectBody): Cell {
  const cell = new Cell(WATCHING, undefined, fn, defaultEquals(undefined));
  own(cell);
  createEffectScope(cell);
  runEffectNow(cell);
  return cell;
}

/**
 * Runs `fn` once inside a tracking scope and keeps an effect only if the run
 * actually read something reactive.
 *
 * This is how the DOM layer decides, by observation rather than by static
 * analysis, whether a template expression is dynamic (ADR-0009). A `class` or
 * text computed from constants costs nothing after the first evaluation.
 */
export function bind(fn: () => void): void {
  const cell = createEffect(fn);
  if (cell.deps === undefined) {
    releaseEffect(cell);
  }
}

/**
 * Runs `fn` immediately, then again whenever something it read changes.
 *
 * Dependencies are re-observed on every run, so a conditional read genuinely
 * drops the dependency it did not take. There is no dependency array, and
 * nothing depends on call order.
 *
 * `fn` may return a cleanup function; it runs before each re-run and on
 * disposal. Effects created inside another effect or a component are owned by
 * it and disposed with it.
 */
export function effect(fn: EffectBody): Dispose {
  if (getOwner() === null) {
    devWarn(
      'effect() was created outside any scope, so nothing will ever dispose it. ' +
        'Wrap it in createRoot() if that is intentional.',
    );
  }
  const cell = createEffect(fn);
  return () => {
    disposeCell(cell);
  };
}
