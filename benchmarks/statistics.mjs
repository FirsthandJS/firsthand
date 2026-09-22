/**
 * The statistics every benchmark in this repository uses.
 *
 * One implementation, imported by all of them. Two copies of a median would
 * be two definitions of what the published numbers mean, and the difference
 * would only ever be found by somebody trying to reproduce them.
 *
 * The choices, and why:
 *
 * - **Median**, not mean, for a scenario. One GC pause should not move a
 *   published number.
 * - **Median absolute deviation** alongside it, for the same reason.
 * - **Geometric mean of ratios** for an aggregate, because the quantities are
 *   ratios: the arithmetic mean of 0.5 and 2.0 is 1.25, which says one
 *   framework wins when neither does.
 * - **A bootstrap interval** around that mean, because a claim about an
 *   aggregate needs to say how sure it is. No advantage is published unless
 *   the interval excludes 1.0.
 */

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarise(values) {
  const mid = median(values);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return {
    samples: values.length,
    median: mid,
    p95: percentile(values, 95),
    mean,
    stddev: Math.sqrt(variance),
    // Median absolute deviation: robust against the one slow run that a GC
    // pause produces, which a standard deviation is not.
    mad: median(values.map((value) => Math.abs(value - mid))),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** Geometric mean of the per-scenario ratios, with a bootstrap interval. */
function aggregate(ratios, iterations = 10000) {
  const geometric = (list) =>
    Math.exp(list.reduce((total, value) => total + Math.log(value), 0) / list.length);
  const point = geometric(ratios);
  const samples = [];
  const random = (() => {
    let state = 12345;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  })();
  for (let i = 0; i < iterations; i++) {
    const draw = ratios.map(() => ratios[Math.floor(random() * ratios.length)]);
    samples.push(geometric(draw));
  }
  samples.sort((a, b) => a - b);
  return {
    geometricMeanRatio: point,
    ci95: [samples[Math.floor(iterations * 0.025)], samples[Math.floor(iterations * 0.975)]],
  };
}

export { median, percentile, summarise, aggregate };
