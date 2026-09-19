/**
 * Native events with delegation (ADR-0012).
 *
 * There is no synthetic event: handlers receive the browser's own `Event`.
 * For the bubbling types below, one real listener per type is installed on the
 * document and dispatch walks the real `composedPath()`, so mounting 100 000
 * rows registers zero listeners.
 */

/** Types worth delegating: they bubble, are composed, and appear in lists. */
const DELEGATED = new Set([
  'click',
  'dblclick',
  'contextmenu',
  'input',
  'beforeinput',
  'change',
  'keydown',
  'keyup',
  'keypress',
  'pointerdown',
  'pointerup',
  'pointermove',
  'mousedown',
  'mouseup',
  'mouseover',
  'mouseout',
  'submit',
  'focusin',
  'focusout',
  'touchstart',
  'touchend',
]);

/** Event types that already have their document-level listener. */
const installed = new Set<string>();

type HandlerHost = Node & Record<string, unknown>;

function key(type: string): string {
  return `$firsthand$${type}`;
}

function dispatch(event: Event): void {
  const name = key(event.type);
  const path = event.composedPath();
  // `currentTarget` is read-only on the real event, so it is redefined per step
  // to keep handlers behaving exactly as they would if attached directly.
  let current: EventTarget | null = null;
  Object.defineProperty(event, 'currentTarget', {
    configurable: true,
    get: () => current,
  });
  for (let i = 0; i < path.length; i++) {
    const node = path[i] as HandlerHost;
    const handler = node[name];
    if (handler !== undefined) {
      current = node;
      (handler as (event: Event) => void).call(node, event);
      // The only way to observe `stopPropagation()` from a delegated
      // dispatch. Deprecated as a setter; still the canonical read.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (event.cancelBubble) {
        break;
      }
    }
    if ((node as unknown) === document) {
      break;
    }
  }
  current = null;
}

/**
 * Attaches an event handler.
 *
 * `options` forces a direct listener: capture, once and passive cannot be
 * expressed through delegation, and forcing one is also the documented escape
 * hatch when a handler must run before a listener attached further up.
 */
export function on(
  node: Element,
  type: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions | true,
): void {
  if (options !== undefined || !DELEGATED.has(type)) {
    node.addEventListener(type, handler, options === true ? undefined : options);
    return;
  }
  (node as unknown as HandlerHost)[key(type)] = handler;
  if (!installed.has(type)) {
    installed.add(type);
    document.addEventListener(type, dispatch);
  }
}

/** Removes a delegated handler. Direct listeners die with their node. */
export function off(node: Element, type: string): void {
  // Assigned rather than deleted: the dispatch loop tests for `undefined`, and
  // clearing the slot keeps the element's shape stable for the engine.
  (node as unknown as HandlerHost)[key(type)] = undefined;
}

/** Test-only: forgets which document listeners were installed. */
export function resetDelegation(): void {
  for (const type of installed) {
    document.removeEventListener(type, dispatch);
  }
  installed.clear();
}
