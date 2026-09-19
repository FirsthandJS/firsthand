/**
 * `Navigate` — a redirect written as an element.
 */
import { onCleanup } from '@firsthandjs/core';
import { component, type View } from '@firsthandjs/dom';
import { useNavigate } from './hooks.js';
import type { NavigateOptions } from './history.js';

export interface NavigateProps extends NavigateOptions {
  readonly to: string;
}

/**
 * Navigates as soon as it is rendered.
 *
 * The navigation is deferred to a microtask rather than performed during
 * setup: setup runs inside the render that is producing this element, and
 * changing the location from there would re-enter the render that is still in
 * progress. Nothing is painted in between, so the redirect is still invisible.
 */
export const Navigate = component<NavigateProps>(
  (props) => {
    const navigate = useNavigate();
    let live = true;
    onCleanup(() => {
      live = false;
    });
    queueMicrotask(() => {
      if (live) {
        navigate(props.to, { replace: props.replace ?? true, state: props.state });
      }
    });
    return null as View;
  },
  undefined,
  'firsthand/router:Navigate',
  'Navigate',
);
