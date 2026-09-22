/**
 * The Vue implementation.
 *
 * Idiomatic Vue 3.5: `shallowRef` for the list, `v-for` with `:key`,
 * `provide`/`inject` for context, `<Teleport>` for the portal, and templates
 * rather than hand-written `h()` calls — Vue's template compiler emits patch
 * flags that a hand-written render function does not get, so measuring the
 * hand-written form would measure a Vue nobody ships.
 *
 * The templates are compiled by Vue's own compiler, from the full bundler
 * build. That happens once per component definition, at module scope, before
 * any measurement; warmups are discarded, so no timed operation includes it.
 *
 * Vue's scheduler flushes on a **microtask**, which cannot be drained from
 * inside a synchronous function — so `run` returns `nextTick()` and the
 * harness awaits it. Without that the clock would stop before the DOM had
 * changed and Vue would be credited for work it had not done. The await costs
 * every framework the same one microtask hop, because the harness awaits all
 * of them.
 */
import {
  createApp,
  defineComponent,
  inject,
  nextTick,
  provide,
  ref,
  shallowRef,
} from 'vue/dist/vue.esm-bundler.js';
import { createDataFactory } from './data.js';

// ---------------------------------------------------------------------------
// Table: the row-list scenarios
// ---------------------------------------------------------------------------

let table;

const Table = defineComponent({
  setup() {
    const rows = shallowRef([]);
    const selected = ref(0);
    const compact = ref(false);
    table = { rows, selected, compact };
    return {
      rows,
      selected,
      compact,
      select(id) {
        selected.value = id;
      },
      remove(id) {
        rows.value = rows.value.filter((row) => row.id !== id);
      },
    };
  },
  template: `<table class="table"><tbody>
    <template v-if="compact">
      <tr v-for="row in rows" :key="row.id"><td class="col-md-1">{{ row.id }}</td></tr>
    </template>
    <template v-else>
      <tr v-for="row in rows" :key="row.id" :class="row.id === selected ? 'danger' : undefined">
        <td class="col-md-1">{{ row.id }}</td>
        <td class="col-md-4"><a class="lbl" @click="select(row.id)">{{ row.label }}</a></td>
        <td class="col-md-1"><a class="remove" @click="remove(row.id)"><span class="glyphicon glyphicon-remove"></span></a></td>
        <td class="col-md-6"></td>
      </tr>
    </template>
  </tbody></table>`,
});

// ---------------------------------------------------------------------------
// Deep tree: one component per level, a leaf at the bottom
// ---------------------------------------------------------------------------

const deepLabel = ref('start');

const Branch = defineComponent({
  name: 'Branch',
  props: { depth: { type: Number, required: true } },
  setup() {
    return { label: deepLabel };
  },
  template: `<span v-if="depth === 0" class="leaf">{{ label }}</span>
    <div v-else class="level"><Branch :depth="depth - 1" /></div>`,
});

const Deep = defineComponent({
  components: { Branch },
  setup() {
    return { chains: Array.from({ length: 20 }, (_, i) => i) };
  },
  template: `<div id="deep"><Branch v-for="i in chains" :key="i" :depth="25" /></div>`,
});

// ---------------------------------------------------------------------------
// Context: one provider, many consumers
// ---------------------------------------------------------------------------

const theme = ref('light');

const Consumer = defineComponent({
  props: { index: { type: Number, required: true } },
  setup() {
    return { theme: inject('theme') };
  },
  template: `<li class="consumer">{{ index }}:{{ theme }}</li>`,
});

const Consumers = defineComponent({
  components: { Consumer },
  props: { count: { type: Number, required: true } },
  setup(props) {
    provide('theme', theme);
    return { indices: Array.from({ length: props.count }, (_, i) => i) };
  },
  template: `<ul id="consumers"><Consumer v-for="i in indices" :key="i" :index="i" /></ul>`,
});

// ---------------------------------------------------------------------------
// Portal: content rendered into a foreign container
// ---------------------------------------------------------------------------

const portalValue = ref(0);

const WithPortal = defineComponent({
  setup() {
    return { value: portalValue, target: document.getElementById('portal-target') };
  },
  template: `<div id="portal-host"><Teleport :to="target"><div id="portal-body"><span class="portal-value">{{ value }}</span></div></Teleport></div>`,
});

// ---------------------------------------------------------------------------
// Input: event-to-DOM latency
// ---------------------------------------------------------------------------

const typed = ref('');

const Input = defineComponent({
  setup() {
    return {
      typed,
      onInput(event) {
        typed.value = event.currentTarget.value;
      },
    };
  },
  template: `<div id="input-host"><input id="field" @input="onInput" /><p id="echo">{{ typed }}</p></div>`,
});

// ---------------------------------------------------------------------------
// Counter: rapid updates
// ---------------------------------------------------------------------------

const counter = ref(0);

const Counter = defineComponent({
  setup() {
    return { counter };
  },
  template: `<p id="counter">{{ counter }}</p>`,
});

// ---------------------------------------------------------------------------

const MODES = {
  table: () => Table,
  deep: () => Deep,
  counter: () => Counter,
  context: () => Consumers,
  portal: () => WithPortal,
  input: () => Input,
};

export function createVueImplementation(container, seed, mode = 'table', argument = 0) {
  const nextData = createDataFactory(seed);
  deepLabel.value = 'start';
  theme.value = 'light';
  counter.value = 0;
  portalValue.value = 0;
  typed.value = '';

  const app = createApp(MODES[mode](), mode === 'context' ? { count: argument } : {});
  app.config.warnHandler = () => undefined;
  app.mount(container);

  return {
    name: 'vue',
    /** Returns a promise: the caller must await it before reading the DOM. */
    async run(operation, value) {
      switch (operation) {
        case 'create':
          table.rows.value = nextData(value);
          break;
        case 'append':
          table.rows.value = table.rows.value.concat(nextData(value));
          break;
        case 'prepend':
          table.rows.value = nextData(value).concat(table.rows.value);
          break;
        case 'updateEveryTenth':
          table.rows.value = table.rows.value.map((row, i) =>
            i % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row,
          );
          break;
        case 'updateOne':
          table.rows.value = table.rows.value.map((row, i) =>
            i === value ? { ...row, label: `${row.label} !!!` } : row,
          );
          break;
        case 'select':
          table.selected.value = table.rows.value[value].id;
          break;
        case 'remove':
          table.rows.value = table.rows.value.filter((_, i) => i !== value);
          break;
        case 'swap': {
          const next = table.rows.value.slice();
          const first = next[1];
          next[1] = next[next.length - 2];
          next[next.length - 2] = first;
          table.rows.value = next;
          break;
        }
        case 'reverse':
          table.rows.value = table.rows.value.slice().reverse();
          break;
        case 'clear':
          table.rows.value = [];
          break;
        case 'toggleBranch':
          table.compact.value = !table.compact.value;
          break;
        case 'portalUpdate':
          portalValue.value += 1;
          break;
        case 'type': {
          const field = document.getElementById('field');
          if (field !== null) {
            field.value = `typed ${String(value)}`;
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
          break;
        }
        case 'deepUpdate':
          deepLabel.value = deepLabel.value === 'start' ? 'changed' : 'start';
          break;
        case 'contextChange':
          theme.value = theme.value === 'light' ? 'dark' : 'light';
          break;
        case 'rapidUnbatched':
          // One flush per write, which is what the unbatched case asks for.
          // Vue has no synchronous flush, so each one is a real microtask.
          for (let i = 0; i < value; i++) {
            counter.value += 1;
            await nextTick();
          }
          return;
        case 'rapidBatched':
          // Vue coalesces by default: n writes, one flush.
          for (let i = 0; i < value; i++) {
            counter.value += 1;
          }
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
      await nextTick();
    },
    dispose() {
      app.unmount();
    },
  };
}
