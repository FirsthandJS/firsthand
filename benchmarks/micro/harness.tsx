/**
 * Micro-benchmarks for the two assumptions that ADRs still carry unmeasured.
 *
 * **ADR-0003** says components are hostless by default because an upgraded
 * custom element costs a constructor call, an upgrade reaction and an extra
 * node per instance. That was stated as "large enough to dominate a mass
 * mount", and never measured. This measures it.
 *
 * **ADR-0012** says the delegated event path is worth its dispatch-time lookup
 * because it registers zero listeners at mount. That trade was also asserted
 * rather than measured. This measures both ends of it: registration cost at
 * mount, and dispatch latency at several nesting depths.
 *
 * Both use the published API. If the numbers contradict the ADRs, the ADRs
 * change — that is what they are for.
 */
import { component, defineElement, on, render, setElementPrefix, signal } from '@firsthandjs/dom';

setElementPrefix('micro');

// ---------------------------------------------------------------------------
// Custom element host versus hostless
// ---------------------------------------------------------------------------

const label = signal(0);

const Hostless = component(
  (props: { index: number }) => (
    <span class="cell">
      {props.index}:{label.value}
    </span>
  ),
  undefined,
  'micro/Hostless',
  'Hostless',
);

const Hosted = component(
  (props: { index: number }) => (
    <span class="cell">
      {props.index}:{label.value}
    </span>
  ),
  { tag: true },
  'micro/Hosted',
  'Hosted',
);
defineElement(Hosted as never);

const Shadowed = component(
  (props: { index: number }) => (
    <span class="cell">
      {props.index}:{label.value}
    </span>
  ),
  { tag: true, shadow: true },
  'micro/Shadowed',
  'Shadowed',
);
defineElement(Shadowed as never);

const VARIANTS: Record<string, (props: { index: number }) => unknown> = {
  hostless: Hostless,
  hosted: Hosted,
  shadowed: Shadowed,
};

// ---------------------------------------------------------------------------
// Delegated versus direct listeners
// ---------------------------------------------------------------------------

/** Builds `count` rows nested `depth` levels deep, with no handlers yet. */
function buildRows(container: HTMLElement, count: number, depth: number): HTMLElement[] {
  const targets: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    let node = container;
    for (let level = 0; level < depth; level++) {
      const wrapper = document.createElement('div');
      node.appendChild(wrapper);
      node = wrapper;
    }
    const button = document.createElement('button');
    button.textContent = String(i);
    node.appendChild(button);
    targets.push(button);
  }
  return targets;
}

function attach(targets: HTMLElement[], delegated: boolean, onHit: () => void): void {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i] as HTMLElement;
    if (delegated) {
      on(target, 'click', onHit);
    } else {
      target.addEventListener('click', onHit);
    }
  }
}

const scratch = document.createElement('div');
document.body.appendChild(scratch);

let mounted: (() => void) | null = null;

globalThis.micro = {
  /** Mounts `count` components of one variant and returns the elapsed time. */
  measureMount(variant: string, count: number): { elapsed: number; nodes: number } {
    this.unmount();
    const container = document.createElement('div');
    scratch.appendChild(container);
    const Component = VARIANTS[variant] as (props: { index: number }) => unknown;

    const start = performance.now();
    const dispose = render(
      () => Array.from({ length: count }, (_, index) => Component({ index })),
      container,
    );
    void document.body.offsetHeight;
    const elapsed = performance.now() - start;

    const nodes = container.querySelectorAll('*').length;
    mounted = () => {
      dispose();
      container.remove();
    };
    return { elapsed, nodes };
  },

  /** Updates every mounted component once and returns the elapsed time. */
  measureUpdate(): number {
    const start = performance.now();
    label.value++;
    void document.body.offsetHeight;
    return performance.now() - start;
  },

  /**
   * Registration cost alone.
   *
   * The rows are built first, untimed: including DOM construction would bury
   * the difference the measurement exists to see.
   */
  measureListenerSetup(delegated: boolean, count: number, depth: number): number {
    this.unmount();
    const container = document.createElement('div');
    scratch.appendChild(container);
    const targets = buildRows(container, count, depth);
    void document.body.offsetHeight;

    let hits = 0;
    const start = performance.now();
    attach(targets, delegated, () => {
      hits++;
    });
    const elapsed = performance.now() - start;
    mounted = () => {
      container.remove();
    };
    void hits;
    return elapsed;
  },

  /** Dispatch cost: clicking every row once, at a given nesting depth. */
  measureDispatch(
    delegated: boolean,
    count: number,
    depth: number,
  ): { elapsed: number; hits: number } {
    this.unmount();
    const container = document.createElement('div');
    scratch.appendChild(container);
    let hits = 0;
    const targets = buildRows(container, count, depth);
    attach(targets, delegated, () => {
      hits++;
    });
    void document.body.offsetHeight;

    const start = performance.now();
    for (let i = 0; i < targets.length; i++) {
      (targets[i] as HTMLElement).click();
    }
    const elapsed = performance.now() - start;
    mounted = () => {
      container.remove();
    };
    return { elapsed, hits };
  },

  unmount(): void {
    if (mounted !== null) {
      mounted();
      mounted = null;
    }
  },
};
