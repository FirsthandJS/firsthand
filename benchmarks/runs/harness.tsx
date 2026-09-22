/**
 * The same component, written both ways, for `run.mjs` to measure.
 *
 * Twenty sites, all derived from one source — the shape a detail view has, and
 * the shape the decision in ADR-0026 turns on.
 */
import { batch, createRoot } from '@firsthandjs/core';
import { component, signal, type Signal } from '@firsthandjs/dom';
import {
  applyChild,
  createComponent,
  insert,
  site,
  store as makeStore,
  template,
  type Slot,
} from '@firsthandjs/dom/internal';

/** The same markup the compiler hoists for the two variants above. */
const hoistedTemplate = template(`<div>${'<span></span>'.repeat(20)}</div>`);

type Person = { name: string; score: number; flag: boolean };

function field(data: Person, n: number): string {
  return data.name + ':' + String((data.score * (n + 1)) % 1000) + (data.flag ? '+' : '-');
}

/** Today: each site reads the source and derives on its own. */
export const Parts = component<{ readonly data: Signal<Person> }>((props) => (
  <div>
    <span>{field(props.data.value, 0)}</span>
    <span>{field(props.data.value, 1)}</span>
    <span>{field(props.data.value, 2)}</span>
    <span>{field(props.data.value, 3)}</span>
    <span>{field(props.data.value, 4)}</span>
    <span>{field(props.data.value, 5)}</span>
    <span>{field(props.data.value, 6)}</span>
    <span>{field(props.data.value, 7)}</span>
    <span>{field(props.data.value, 8)}</span>
    <span>{field(props.data.value, 9)}</span>
    <span>{field(props.data.value, 10)}</span>
    <span>{field(props.data.value, 11)}</span>
    <span>{field(props.data.value, 12)}</span>
    <span>{field(props.data.value, 13)}</span>
    <span>{field(props.data.value, 14)}</span>
    <span>{field(props.data.value, 15)}</span>
    <span>{field(props.data.value, 16)}</span>
    <span>{field(props.data.value, 17)}</span>
    <span>{field(props.data.value, 18)}</span>
    <span>{field(props.data.value, 19)}</span>
  </div>
));

/** The run: read once, derive once, write what changed. */
export const Run = component<{ readonly data: Signal<Person> }>((props) => () => {
  const person = props.data.value;
  return (
    <div>
      <span>{field(person, 0)}</span>
      <span>{field(person, 1)}</span>
      <span>{field(person, 2)}</span>
      <span>{field(person, 3)}</span>
      <span>{field(person, 4)}</span>
      <span>{field(person, 5)}</span>
      <span>{field(person, 6)}</span>
      <span>{field(person, 7)}</span>
      <span>{field(person, 8)}</span>
      <span>{field(person, 9)}</span>
      <span>{field(person, 10)}</span>
      <span>{field(person, 11)}</span>
      <span>{field(person, 12)}</span>
      <span>{field(person, 13)}</span>
      <span>{field(person, 14)}</span>
      <span>{field(person, 15)}</span>
      <span>{field(person, 16)}</span>
      <span>{field(person, 17)}</span>
      <span>{field(person, 18)}</span>
      <span>{field(person, 19)}</span>
    </div>
  );
});

/**
 * The same run, with its sites and its navigation taken once.
 *
 * Written by hand against the published protocol — there is no benchmark-only
 * runtime — to measure what the compiler would gain by hoisting. Today it
 * emits `site(store, i)` per write and re-walks twenty `nextSibling` steps on
 * every pass, even though the element it walks is the one it walked last time.
 *
 * This is the same twenty sites, the same template and the same writes, with
 * both taken once per instance instead of once per run.
 */
/**
 * What `writeChild` does, minus the lookup this variant has already done.
 *
 * The same comparison and the same `applyChild`, through the published
 * protocol: what is being measured is the lookup and the navigation, so
 * everything else has to be the same work.
 */
function write(slot: Slot, parent: Node, value: string): void {
  if (value === slot.text) {
    return;
  }
  slot.text = value;
  slot.node = applyChild(parent, null, slot.node ?? null, value);
}

const Hoisted = component<{ readonly data: Signal<Person> }>((props) => {
  const store = makeStore('Hoisted');
  let cells: Node[] | null = null;
  let root: Node | null = null;
  let slots: Slot[] | null = null;

  return () => {
    const person = props.data.value;
    if (root === null) {
      root = hoistedTemplate();
      slots = Array.from({ length: 20 }, (_, i) => site(store, i));
      const found: Node[] = [];
      let node = root.firstChild as Node;
      for (let i = 0; i < 20; i++) {
        found.push(node);
        node = node.nextSibling as Node;
      }
      cells = found;
    }
    for (let i = 0; i < 20; i++) {
      write((slots as Slot[])[i] as Slot, (cells as Node[])[i] as Node, field(person, i));
    }
    return root;
  };
});

const rows: Signal<Person>[] = [];
let disposer: (() => void) | null = null;

globalThis.runsHarness = {
  mount(which: 'Parts' | 'Run' | 'Hoisted', count: number) {
    if (disposer !== null) {
      disposer();
    }
    document.body.innerHTML = '<div id="app"></div>';
    const host = document.getElementById('app') as HTMLElement;
    rows.length = 0;
    for (let i = 0; i < count; i++) {
      rows.push(signal({ name: 'row ' + String(i), score: i % 97, flag: i % 2 === 0 }));
    }
    const target = which === 'Parts' ? Parts : which === 'Run' ? Run : Hoisted;
    const start = performance.now();
    let stop: () => void = () => undefined;
    createRoot((dispose) => {
      stop = dispose;
      for (const row of rows) {
        const made = createComponent(target, { data: row });
        // A setup that returned a render function hands back a function, and
        // it has to be bound rather than appended.
        if (typeof made === 'function') {
          insert(host, made);
        } else {
          host.append(...(Array.isArray(made) ? (made as Node[]) : [made as Node]));
        }
      }
    });
    disposer = stop;
    const elapsed = performance.now() - start;
    // Proof that something was actually rendered, so a variant that quietly
    // draws nothing cannot look fast.
    return { elapsed, nodes: host.querySelectorAll('span').length };
  },
  update(times: number) {
    const start = performance.now();
    for (let n = 0; n < times; n++) {
      batch(() => {
        for (const row of rows) {
          const old = row.peek();
          row.value = { ...old, score: (old.score + 1) % 97 };
        }
      });
    }
    return (performance.now() - start) / times;
  },
  heap() {
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  },
};
