/**
 * `Link` and `NavLink`.
 *
 * Both render a real `<a href>`: the URL is in the status bar, middle-click and
 * ctrl-click open a tab, and a crawler sees a link. Only a plain left-click on
 * a same-window link is intercepted — everything else is left to the browser,
 * which is the part single-page routers most often get wrong.
 *
 * They are built with DOM calls rather than TSX so that this package needs no
 * compiler pass of its own; it is a few nodes, and writing them out keeps the
 * dependency surface at zero.
 */
import { bind, computed, useContext, type ReadonlyProps } from '@firsthandjs/core';
import { component, type View } from '@firsthandjs/dom';
import { insert, on, rest, setAttribute, setClass, spread } from '@firsthandjs/dom/internal';
import { isActivePath, useBasePath, resolvePath } from './hooks.js';
import { RouterContext } from './router.js';
import { preloadRoutes } from './routes.js';

export interface LinkProps {
  readonly to: string;
  readonly replace?: boolean;
  readonly state?: unknown;
  /**
   * Starts loading the target route's code on hover and on focus.
   *
   * The chunk is then usually already there when the click happens, which is
   * what makes on-demand loading feel like no loading at all.
   */
  readonly preload?: boolean;
  readonly onClick?: (event: MouseEvent) => void;
  readonly children?: View;
  /** Anything else is forwarded to the anchor. */
  readonly [attribute: string]: unknown;
}

export interface NavLinkProps extends LinkProps {
  /** Active only on an exact match, rather than on a prefix. */
  readonly end?: boolean;
  /** Class added while the link is active. Defaults to `active`. */
  readonly activeClass?: string;
  readonly class?: string;
}

const OWN = ['to', 'replace', 'state', 'preload', 'onClick', 'children'];
const NAV_OWN = [...OWN, 'end', 'activeClass', 'class'];

/** A plain left-click on a same-window link, which the router should handle. */
function isPlainClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (anchor.target === '' || anchor.target === '_self')
  );
}

function buildAnchor(props: ReadonlyProps<LinkProps>, own: readonly string[]): HTMLAnchorElement {
  const router = useContext(RouterContext);
  const base = useBasePath();
  const anchor = document.createElement('a');
  const target = computed(() => resolvePath(props.to, base.value));

  bind(() => {
    setAttribute(anchor, 'href', router.value.history.href(target.value));
  });
  // Every other prop, applied reactively: reading them here is what subscribes.
  const forwarded = rest(props, own);
  bind(() => {
    spread(anchor, forwarded);
  });
  insert(anchor, () => props.children);

  on(anchor, 'click', (event: Event) => {
    const click = event as MouseEvent;
    props.onClick?.(click);
    if (click.defaultPrevented || !isPlainClick(click, anchor)) {
      return;
    }
    click.preventDefault();
    const { history } = router.value;
    const options = { replace: props.replace === true, state: props.state };
    if (props.replace === true) {
      history.replace(target.value, options);
    } else {
      history.push(target.value, options);
    }
  });

  if (props.preload === true) {
    const warm = (): void => {
      preloadRoutes(router.value.routes, target.value);
    };
    // Directly, not through delegation: `pointerenter` and `focus` do not
    // bubble, so there is nothing for a document-level listener to catch.
    anchor.addEventListener('pointerenter', warm);
    anchor.addEventListener('focus', warm);
  }

  return anchor;
}

export const Link = component<LinkProps>(
  (props) => buildAnchor(props, OWN),
  undefined,
  'firsthand/router:Link',
  'Link',
);

/** A `Link` that knows whether it points at where you already are. */
export const NavLink = component<NavLinkProps>(
  (props) => {
    const anchor = buildAnchor(props, NAV_OWN);
    const router = useContext(RouterContext);
    const base = useBasePath();
    const active = computed(() =>
      isActivePath(
        router.value.history.location.value.pathname,
        resolvePath(props.to, base.value),
        props.end === true,
      ),
    );
    bind(() => {
      const extra = active.value ? (props.activeClass ?? 'active') : '';
      const own = props.class ?? '';
      setClass(anchor, `${own}${own !== '' && extra !== '' ? ' ' : ''}${extra}`);
      setAttribute(anchor, 'aria-current', active.value ? 'page' : null);
    });
    return anchor;
  },
  undefined,
  'firsthand/router:NavLink',
  'NavLink',
);
