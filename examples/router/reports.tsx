/**
 * A page that is not in the initial bundle.
 *
 * Nothing here is special: it is an ordinary component in an ordinary module.
 * What makes it a separate chunk is that the route refers to it through
 * `lazy: () => import('./reports')`, which the bundler turns into its own file
 * and the browser fetches the first time someone enters the route.
 */
import { component, signal } from '@firsthandjs/dom';

const ROWS = [
  { quarter: 'Q1', revenue: 128_400 },
  { quarter: 'Q2', revenue: 141_900 },
  { quarter: 'Q3', revenue: 133_050 },
  { quarter: 'Q4', revenue: 167_220 },
];

export default component(() => {
  console.info('reports setup');
  const total = signal(ROWS.reduce((sum, row) => sum + row.revenue, 0));

  return (
    <section data-page="reports">
      <h2>Reports</h2>
      <p>
        This module was downloaded when you entered the route, not when the page loaded. Total:{' '}
        <b id="total">{total.value.toLocaleString('en-US')}</b>
      </p>
      <table>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.quarter}>
              <td>{row.quarter}</td>
              <td>{row.revenue.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => (total.value += 1000)}>add 1 000</button>
    </section>
  );
});
