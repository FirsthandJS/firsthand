/**
 * The mode a server render runs in.
 *
 * An effect is a side effect over time. A render that produces one string has
 * no time — there is no later for a second run to happen in, no DOM to touch
 * and no cleanup that will ever be called — so effects are created and not
 * run. Everything else about the graph is unchanged: signals, computeds and
 * context behave exactly as they do in a browser, which is what makes the same
 * components render in both places.
 */
import { describe, expect, it } from 'vitest';
import { createRoot, effect, isRendering, setRendering, signal } from '../src/index.js';

describe('rendering mode', () => {
  it('is off to begin with', () => {
    expect(isRendering()).toBe(false);
  });

  it('hands back what it replaced, so it can be restored', () => {
    const previous = setRendering(true);
    expect(previous).toBe(false);
    expect(isRendering()).toBe(true);
    expect(setRendering(previous)).toBe(true);
    expect(isRendering()).toBe(false);
  });

  it('creates an effect without running it', () => {
    const previous = setRendering(true);
    let runs = 0;
    createRoot((dispose) => {
      effect(() => {
        runs++;
      });
      expect(runs).toBe(0);
      dispose();
    });
    setRendering(previous);
  });

  it('runs an effect as usual once it is off again', () => {
    let runs = 0;
    createRoot((dispose) => {
      const count = signal(0);
      effect(() => {
        count.value;
        runs++;
      });
      expect(runs).toBe(1);
      dispose();
    });
  });
});
