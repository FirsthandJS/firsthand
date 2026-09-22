/**
 * Two sub-millisecond scenarios, taken apart.
 *
 * `portal-update` and `input-event-latency` are the two rows where Firsthand
 * is furthest behind Solid, and in a geometric mean every scenario counts the
 * same — so 0.135 ms of portal hurts the aggregate more than 2.5 ms of a
 * ten-thousand-row update. Before optimising either, this establishes what is
 * actually in them.
 *
 * Both questions have the same shape, and both are asked twice: once with the
 * clock stopped before the browser is made to lay the page out, and once
 * after. A number that is mostly layout says "the benchmark is measuring the
 * browser"; a number that is mostly framework says where to profile.
 *
 * - **text-update**: the same signal writing the same text node, in the
 *   mounting container and through a portal. A portal moves nodes at mount
 *   and should have no update path of its own, so if these differ there is a
 *   hidden owner, part or scheduling effect. If they do not, the scenario's
 *   gap is the benchmark or the layout rather than the portal.
 * - **event-to-text**: an input event reaching a text node, through a
 *   delegated listener and through a direct one. Delegation costs a
 *   `composedPath()` and a walk per event and saves a registration per node;
 *   this is the dispatch end of that trade, in isolation.
 * - **dispatch only**: the same event with a handler that does nothing, so
 *   the walk can be separated from the write it leads to.
 */
import { component, on, portal, render, signal } from '@firsthandjs/dom';

const plain = signal(0);
const ported = signal(0);
const typed = signal('');

let scratch: HTMLElement;
let portalTarget: HTMLElement;
const disposers: (() => void)[] = [];

/** A text node in the mounting container. */
const Plain = component(() => <p id="plain">{plain.value}</p>);

/** The same text node, moved elsewhere at mount. */
const Ported = component(() => (
  <div id="portal-host">{portal(<p id="ported">{ported.value}</p>, portalTarget)}</div>
));

/** An input whose handler writes a signal a text node reads. */
const Delegated = component(() => (
  <div>
    <input
      id="delegated"
      onInput={(event) => {
        typed.value = (event.currentTarget as HTMLInputElement).value;
      }}
    />
    <p id="delegated-echo">{typed.value}</p>
  </div>
));

/**
 * The same, with a direct listener.
 *
 * `on` with options forces a direct registration — capture, once and passive
 * cannot be expressed through delegation, so that is the documented escape
 * hatch and the only way to ask for one.
 */
const Direct = component(() => {
  const field = (<input id="direct" />) as HTMLInputElement;
  on(
    field,
    'input',
    (event) => {
      typed.value = (event.currentTarget as HTMLInputElement).value;
    },
    { capture: false },
  );
  return (
    <div>
      {field}
      <p id="direct-echo">{typed.value}</p>
    </div>
  );
});

/** An input whose handler does nothing, to price the dispatch on its own. */
const Empty = component(() => (
  <div>
    <input id="empty" onInput={() => undefined} />
  </div>
));

const VARIANTS: Record<string, () => unknown> = {
  plain: () => <Plain />,
  ported: () => <Ported />,
  delegated: () => <Delegated />,
  direct: () => <Direct />,
  empty: () => <Empty />,
};

/** What each variant does once, as the thing being timed. */
const OPERATIONS: Record<string, () => void> = {
  plain: () => {
    plain.value++;
  },
  ported: () => {
    ported.value++;
  },
  delegated: () => type('delegated'),
  direct: () => type('direct'),
  empty: () => type('empty'),
};

let sequence = 0;

/** The path a user takes: a real input event on the field. */
function type(id: string): void {
  const field = document.getElementById(id) as HTMLInputElement;
  field.value = `typed ${String(sequence++)}`;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

(globalThis as unknown as { latency: unknown }).latency = {
  setup(): void {
    document.body.innerHTML = '<div id="scratch"></div><div id="portal-target"></div>';
    scratch = document.getElementById('scratch') as HTMLElement;
    portalTarget = document.getElementById('portal-target') as HTMLElement;
  },

  mount(variant: string): number {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    scratch.innerHTML = '';
    portalTarget.innerHTML = '';
    plain.value = 0;
    ported.value = 0;
    typed.value = '';
    disposers.push(render(VARIANTS[variant] as () => never, scratch));
    void document.body.offsetHeight;
    return scratch.querySelectorAll('*').length + portalTarget.querySelectorAll('*').length;
  },

  /**
   * One operation, `times` over.
   *
   * `layout` decides whether the clock stops before or after the browser has
   * been made to lay the page out again. Both are worth knowing and they are
   * different questions.
   */
  measure(variant: string, times: number, layout: boolean): number {
    const operation = OPERATIONS[variant] as () => void;
    const started = performance.now();
    for (let i = 0; i < times; i++) {
      operation();
      if (layout) {
        void document.body.offsetHeight;
      }
    }
    const elapsed = (performance.now() - started) / times;
    // Outside the clock, so the next repetition starts from a laid-out page
    // either way.
    void document.body.offsetHeight;
    return elapsed;
  },

  /**
   * One operation on a tree that has just been mounted.
   *
   * What the main suite measures: it mounts, sets up, times a single
   * operation and unmounts, once per repetition. That is a different question
   * from the steady-state cost above — the first write after a mount pays for
   * whatever is still cold — and the difference between the two is the point
   * of asking both.
   */
  measureFirst(variant: string, layout: boolean): number {
    this.setup();
    this.mount(variant);
    const operation = OPERATIONS[variant] as () => void;
    const started = performance.now();
    operation();
    if (layout) {
      void document.body.offsetHeight;
    }
    return performance.now() - started;
  },

  /** What is on screen, so a variant that quietly does nothing cannot win. */
  shown(variant: string): string {
    const ids: Record<string, string> = {
      plain: 'plain',
      ported: 'ported',
      delegated: 'delegated-echo',
      direct: 'direct-echo',
      empty: 'empty',
    };
    const node = document.getElementById(ids[variant] as string);
    return node === null ? '' : (node.textContent ?? (node as HTMLInputElement).value ?? '');
  },
};
