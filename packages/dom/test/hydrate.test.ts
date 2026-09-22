/**
 * The machinery hydration is made of, on its own.
 *
 * The suites in `@firsthandjs/server` drive this through real components,
 * which is where it matters. These are the edges a component cannot easily be
 * made to reach: a claim asked for outside a hydration, a marker that is not
 * where the markup says it should be, and regions inside regions.
 */
import { describe, expect, it, vi } from 'vitest';
import { adopt, claimRegion, hydrateWith, place, within } from '@/hydrate.js';
import { first, next } from '@/claim.js';
import { devHydrationMismatch } from '@/dev.js';
import { store, writeChild } from '@/insert.js';

function tree(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('walking a template', () => {
  it('is the property reads when nothing is being hydrated', () => {
    const host = tree('<p></p><b></b>');
    expect(first(host)).toBe(host.firstChild);
    expect(next(host.firstChild as Node)).toBe(host.lastChild);
  });

  it('steps over a whole region, landing on the marker the template has', () => {
    const host = tree('a<!--[-->one<i></i><!----><b></b>');
    hydrateWith(host, () => {
      const marker = next(host.firstChild as Node);
      expect(marker.nodeType).toBe(8);
      expect(marker.nextSibling).toBe(host.lastChild);
    });
  });

  it('steps over a region that begins where it starts looking', () => {
    const host = tree('<!--[-->one<!----><b></b>');
    hydrateWith(host, () => {
      expect(first(host).nodeType).toBe(8);
      expect(first(host).nextSibling).toBe(host.lastChild);
    });
  });

  it('counts regions inside regions', () => {
    const host = tree('a<!--[--><!--[-->in<!---->out<!----><b></b>');
    hydrateWith(host, () => {
      const marker = next(host.firstChild as Node);
      expect(marker.nextSibling).toBe(host.lastChild);
    });
  });

  it('walks to the end when a region has no marker after it', () => {
    const host = tree('a<!--[-->one');
    hydrateWith(host, () => {
      // The last dynamic child of an element: the element's end is where it
      // stops, and nothing navigates past it.
      expect(next(host.firstChild as Node)).toBe(null);
    });
  });
});

describe('placing an anchor where hydration has got to', () => {
  it('places nothing when nothing is being hydrated', () => {
    expect(place(document.createTextNode(''))).toBe(null);
  });

  it('goes in before the next node the region has not handed out', () => {
    const host = tree('<p></p><b></b>');
    const anchor = document.createTextNode('');
    hydrateWith(host, () => {
      expect(place(anchor)).toBe(host);
    });
    expect(host.firstChild).toBe(anchor);
  });

  it('places nothing once the region is used up', () => {
    const host = tree('<p></p>');
    hydrateWith(host, () => {
      adopt('P');
      expect(place(document.createTextNode(''))).toBe(null);
    });
  });
});

describe('adopting a node', () => {
  it('hands back nothing when nothing is being hydrated', () => {
    expect(adopt('P')).toBe(null);
  });

  it('hands back nothing once the region is used up', () => {
    const host = tree('<p></p>');
    hydrateWith(host, () => {
      expect(adopt('P')).toBe(host.firstChild);
      expect(adopt('P')).toBe(null);
    });
  });

  it('leaves a node that is not the one asked for where it is', () => {
    const host = tree('<p></p>');
    hydrateWith(host, () => {
      expect(adopt('SPAN')).toBe(null);
      expect(host.firstChild).not.toBe(null);
    });
  });
});

describe('claiming a region', () => {
  it('takes the whole content when there is no opening marker', () => {
    // A dynamic child that is the whole of its element: the server leaves the
    // opener out, because where the children start is where the region does.
    const host = tree('<p></p>');
    hydrateWith(host, () => {
      expect(claimRegion(host, null)?.nodes).toBe(host.firstChild);
    });
  });

  it('finds nothing for a second claim against a parent with one region', () => {
    const host = tree('<p></p>');
    hydrateWith(host, () => {
      claimRegion(host, null);
      expect(claimRegion(host, null)).toBe(null);
    });
  });

  it('refuses a region that does not end where the marker is', () => {
    const host = tree('<!--[-->one<!----><b></b>');
    const elsewhere = host.lastChild as Node;
    hydrateWith(host, () => {
      expect(claimRegion(host, elsewhere)).toBe(null);
    });
  });

  it('hands over the nodes between the markers, and the text when it is text', () => {
    const host = tree('<!--[-->one<!---->');
    hydrateWith(host, () => {
      const claimed = claimRegion(host, host.lastChild);
      expect(claimed?.text).toBe('one');
      expect(claimed?.nodes).toBe(host.childNodes[1]);
    });
  });

  it('hands over nothing for a region the server left empty', () => {
    const host = tree('<!--[--><!---->');
    hydrateWith(host, () => {
      const claimed = claimRegion(host, host.lastChild);
      expect(claimed?.nodes).toBe(null);
      expect(claimed?.text).toBeUndefined();
    });
  });

  it('hands over a list of nodes, and no text, when there are several', () => {
    const host = tree('<!--[--><i></i><b></b><!---->');
    hydrateWith(host, () => {
      const claimed = claimRegion(host, host.lastChild);
      expect(claimed?.nodes).toHaveLength(2);
      expect(claimed?.text).toBeUndefined();
    });
  });

  it('takes the regions of one parent in the order they appear', () => {
    const host = tree('<!--[-->one<!----><!--[-->two<!---->');
    hydrateWith(host, () => {
      expect(claimRegion(host, host.childNodes[2] as Node)?.text).toBe('one');
      expect(claimRegion(host, host.childNodes[5] as Node)?.text).toBe('two');
    });
  });

  it('removes the opening markers once the whole tree has been adopted', () => {
    const host = tree('<!--[-->one<!---->');
    hydrateWith(host, () => {
      claimRegion(host, host.lastChild);
    });
    expect(host.innerHTML).toBe('one<!---->');
  });

  it('counts nested hydrations and sweeps once', () => {
    const host = tree('<!--[-->one<!---->');
    hydrateWith(host, () => {
      claimRegion(host, host.lastChild);
      hydrateWith(host, () => undefined);
      // The inner call has returned and the marker is still there: the sweep
      // belongs to the outermost one.
      expect(host.innerHTML).toBe('<!--[-->one<!---->');
    });
    expect(host.innerHTML).toBe('one<!---->');
  });
});

describe('a region handed to somebody else', () => {
  it('is what the next claim against that marker gets', () => {
    const host = tree('<!--[-->one<!---->');
    hydrateWith(host, () => {
      const claimed = claimRegion(host, host.lastChild);
      const anchor = document.createTextNode('');
      host.append(anchor);
      within(claimed!.region, () => undefined);
    });
    expect(host.textContent).toBe('one');
  });
});

describe('reporting a mismatch', () => {
  it('says nothing about a template that is not an element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    devHydrationMismatch(document.createElement('p'), 'just text');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says nothing when every attribute agrees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    devHydrationMismatch(
      tree('<p class="a"></p>').firstElementChild as Element,
      '<p class="a"></p>',
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('names the attribute that does not, and the one it wanted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    devHydrationMismatch(tree('<p></p>').firstElementChild as Element, '<p class="a"></p>');
    expect(warn.mock.calls.join(' ')).toContain('class');
    warn.mockRestore();
  });
});

describe('a run writing over markup', () => {
  it('writes the position itself when the region does not end where the marker is', () => {
    // The server and the browser disagree about this subtree: what was sent
    // stops before the node the client navigated to. Nothing is adopted on a
    // guess — the site writes what it describes.
    const host = tree('<!--[-->one<!----><b></b>');
    const elsewhere = host.lastChild as Node;
    hydrateWith(host, () => {
      writeChild(store('X'), 0, host, elsewhere, 'two');
    });
    expect(host.textContent).toBe('onetwo');
  });
});
