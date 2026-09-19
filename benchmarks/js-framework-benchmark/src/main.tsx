/**
 * The Firsthand implementation for js-framework-benchmark (keyed).
 *
 * The row component, the keyed list and every operation come from
 * `benchmarks/app/table.tsx` — the same file the repository's own benchmark
 * uses, imported unchanged. Only the page around it is written here, because
 * the upstream harness dictates the buttons and their ids.
 *
 * That constraint is the point: an independent measurement is only worth
 * reading if it measures the same code an application would run.
 * `npm run check:benchmark-shared` fails if this file stops importing it.
 */
import { component, render } from '@firsthandjs/dom';
import { Table, createTableOperations } from '../../app/table.js';

const run = createTableOperations(0x51a2d);

const Controls = component(() => (
  <div class="jumbotron">
    <div class="row">
      <div class="col-md-6">
        <h1>Firsthand</h1>
      </div>
      <div class="col-md-6">
        <div class="row">
          <Button id="run" label="Create 1,000 rows" onRun={() => run('create', 1000)} />
          <Button id="runlots" label="Create 10,000 rows" onRun={() => run('create', 10000)} />
          <Button id="add" label="Append 1,000 rows" onRun={() => run('append', 1000)} />
          <Button
            id="update"
            label="Update every 10th row"
            onRun={() => run('updateEveryTenth', 0)}
          />
          <Button id="clear" label="Clear" onRun={() => run('clear', 0)} />
          <Button id="swaprows" label="Swap Rows" onRun={() => run('swap', 0)} />
        </div>
      </div>
    </div>
  </div>
));

const Button = component((props: { id: string; label: string; onRun: () => void }) => (
  <div class="col-sm-6 smallpad">
    <button id={props.id} class="btn btn-primary btn-block" type="button" onClick={props.onRun}>
      {props.label}
    </button>
  </div>
));

const App = component(() => (
  <div class="container">
    <Controls />
    <Table />
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
  </div>
));

render(() => <App />, document.body);
