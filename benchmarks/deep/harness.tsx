/**
 * One row of ten thousand, changed two ways.
 *
 * The question this answers is whether Firsthand needs a new list API to
 * match a fine-grained store, or already has one. Solid's benchmark
 * implementation uses `createStore`, so a label change is a write to one
 * nested signal and the list is never re-run. Firsthand's uses a
 * `signal<Row[]>`, so a label change is a new array and the list re-keys ten
 * thousand rows to move one text node.
 *
 * `deepSignal` is the tool that ought to close that. This measures whether it
 * does, over the same rows, the same markup and the same change.
 */
import { createRoot } from '@firsthandjs/core';
import { component, signal } from '@firsthandjs/dom';
import { createComponent, insert } from '@firsthandjs/dom/internal';
import { deepSignal } from '@firsthandjs/deep';

type Row = { id: number; label: string };

const build = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, label: `row ${String(i + 1)}` }));

// --- an array in a signal: a change is a new array -------------------------

const plain = signal<Row[]>([]);

const Plain = component(() => (
  <table>
    <tbody>
      {plain.value.map((row) => (
        <tr key={row.id}>
          <td>{row.id}</td>
          <td>{row.label}</td>
        </tr>
      ))}
    </tbody>
  </table>
));

// --- a deep array: a change is a write to one property ---------------------

const deep = deepSignal({ rows: [] as Row[] });

const Deep = component(() => (
  <table>
    <tbody>
      {deep.rows.map((row) => (
        <tr key={row.id}>
          <td>{row.id}</td>
          <td>{row.label}</td>
        </tr>
      ))}
    </tbody>
  </table>
));

let disposer: (() => void) | null = null;

(globalThis as unknown as { deepHarness: unknown }).deepHarness = {
  mount(which: 'Plain' | 'Deep', count: number) {
    disposer?.();
    document.body.innerHTML = '<div id="app"></div>';
    const host = document.getElementById('app') as HTMLElement;
    const rows = build(count);
    if (which === 'Plain') {
      plain.value = rows;
    } else {
      deep.rows = rows;
    }
    const target = which === 'Plain' ? Plain : Deep;
    const started = performance.now();
    let stop: () => void = () => undefined;
    createRoot((dispose) => {
      stop = dispose;
      const made = createComponent(target as never, {});
      if (typeof made === 'function') {
        insert(host, made);
      } else {
        host.append(made as Node);
      }
    });
    disposer = stop;
    return { elapsed: performance.now() - started, nodes: host.querySelectorAll('td').length };
  },
  /**
   * One label changed, `times` over.
   *
   * `layout` decides whether the clock stops before or after the browser has
   * been made to lay the page out again. Both are worth knowing and they are
   * different questions: with it, the number is what a user waits for; without
   * it, the number is what the framework did. A ten-thousand-row table spends
   * most of the first on the second's behalf.
   */
  update(which: 'Plain' | 'Deep', index: number, times: number, layout = true) {
    const started = performance.now();
    for (let n = 0; n < times; n++) {
      const label = `changed ${String(n)}`;
      if (which === 'Plain') {
        plain.value = plain.value.map((row, i) => (i === index ? { ...row, label } : row));
      } else {
        (deep.rows[index] as Row).label = label;
      }
      if (layout) {
        document.body.offsetHeight;
      }
    }
    const elapsed = (performance.now() - started) / times;
    // Outside the clock, so the next repetition starts from a laid-out page
    // either way.
    document.body.offsetHeight;
    return elapsed;
  },
  text(index: number) {
    return document.querySelectorAll('tr')[index]?.textContent ?? '';
  },
};
