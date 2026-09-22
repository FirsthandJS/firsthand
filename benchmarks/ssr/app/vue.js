/**
 * The Vue implementation, as render functions.
 *
 * No single-file components: this benchmark measures a server rendering a
 * component tree, and `@vue/compiler-sfc` would add a second toolchain to the
 * measurement without changing what is being measured. `h` is what an SFC
 * compiles to.
 */
import { h } from 'vue';

const Row = {
  props: ['row', 'selected'],
  setup(props) {
    return () =>
      // Vue writes `class=""` for an undefined class, where the others write
      // no attribute at all. The property is left out instead, so that the
      // four documents are the same document.
      h('tr', props.row.id === props.selected ? { class: 'danger' } : {}, [
        h('td', { class: 'col-md-1' }, props.row.id),
        h('td', { class: 'col-md-4' }, [
          h('a', { class: 'lbl', onClick: () => undefined }, props.row.label),
        ]),
        h('td', { class: 'col-md-1' }, [
          h('a', { class: 'remove', onClick: () => undefined }, [
            h('span', { class: 'glyphicon glyphicon-remove' }),
          ]),
        ]),
        h('td', { class: 'col-md-6' }),
      ]);
  },
};

export const Table = {
  props: ['rows', 'selected'],
  setup(props) {
    return () =>
      h('table', { class: 'table' }, [
        h(
          'tbody',
          {},
          props.rows.map((row) => h(Row, { key: row.id, row, selected: props.selected })),
        ),
      ]);
  },
};
