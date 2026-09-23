/**
 * Which sites a run keeps, in every shape a run comes in.
 */

import { describe, expect, it } from 'vitest';

import { compile } from './compile.js';

describe('a child a run keeps', () => {
  it('makes it once and feeds it through a cell', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './row.js';
export const List = component(() => () => {
  const user = profile.value;
  return <ul><Row name={user.name} /></ul>;
});
`);
    // Made once, held in its site, and handed back unchanged afterwards.
    expect(out).toContain('_$cell(');
    expect(out).toContain('_$open(');
    expect(out).toMatch(/_kept\$\d+\.last = _\$part/);
  });

  it('leaves a prop that is nobody’s local as a plain getter', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './row.js';
export const List = component(() => () => {
  const user = profile.value;
  return <ul><Row name={other.value} /></ul>;
});
`);
    expect(out).not.toContain('_$cell(');
  });

  it('feeds its children through a cell too, not only its props', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box } from './box.js';
export const Panel = component(() => () => {
  const failed = status.value === 'error';
  return <Box>{failed ? <p>no</p> : <ul>yes</ul>}</Box>;
});
`);
    // The cell holds the reading rather than the result: the child is a part,
    // and what it reads belongs to the part rather than to the run.
    expect(out).toMatch(/_\$cell\(_store, \d+, \(\) =>/);
    expect(out).toMatch(/_\$part\(\(\) => _cell\$\d+\.value\(\)\)/);
  });

  it('leaves a child that is nobody’s local where it is', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box } from './box.js';
export const Panel = component(() => () => {
  const failed = status.value === 'error';
  return <Box>{other.value}</Box>;
});
`);
    expect(out).not.toContain('_$cell(');
    expect(out).toContain('_$part(() => other.value)');
  });

  it('gives a keyed list its data from the run, and makes the list once', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => () => {
  const shown = rows.value.filter((row) => row.on);
  return <Box>{shown.map((row) => <Row key={row.id} row={row} />)}</Box>;
});
`);
    // The data is read from the cell; the list itself is still made once, or
    // a list that reuses its rows would have nothing to reuse.
    expect(out).toMatch(/_\$list\(\(\) => _cell\$\d+\.value/);
    expect(out).toMatch(/_kept\$\d+\.last = _\$part/);
  });

  it('leaves a keyed list whose data is nobody’s local alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => () => {
  const unrelated = other.value;
  return <Box>{rows.value.map((row) => <Row key={row.id} row={row} />)}</Box>;
});
`);
    expect(out).toContain('_$list(() => rows.value');
  });

  it('gives each list one cell, whichever position it is in', () => {
    // Two paths feed a run's data to a list: `listFedByRun` for a list in a
    // host element's children, `keepReading` for one in a component's. They
    // are different positions and must not both fire for one list — a source
    // wrapped twice would read a cell holding a thunk holding a cell.
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => () => {
  const shown = rows.value.filter((row) => row.on);
  return (
    <section>
      <ul>{shown.map((row) => <Row key={row.id} row={row} />)}</ul>
      <Box>{shown.map((row) => <Row key={row.id} row={row} />)}</Box>
    </section>
  );
});
`);
    expect(out.match(/_\$list\(/g)).toHaveLength(2);
    expect(out.match(/_\$cell\(/g)).toHaveLength(2);
  });

  it('leaves a keyed list outside a run alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Row } from './box.js';
export const Panel = component(() => (
  <Box>{rows.value.map((row) => <Row key={row.id} row={row} />)}</Box>
));
`);
    expect(out).toContain('_$list(() => rows.value');
    expect(out).not.toContain('_$cell(');
  });
});

describe('runs, in every shape they come in', () => {
  it('finds a run returned from a setup with no block of its own', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => () => <p>{state.value}</p>);
`);
    expect(out).toContain('_$store(');
    expect(out).toContain('_$ran(');
  });

  it('closes a run that returns nothing at all', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    if (hidden.value) {
      return;
    }
    return <p>here</p>;
  };
});
`);
    expect(out).toContain('_$ran(_store, undefined)');
  });

  it('leaves a name that only looks like ours alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
function signal(x) {
  return x;
}
export const Panel = component(() => {
  return () => {
    const n = signal(1);
    return <p>{n}</p>;
  };
});
`);
    expect(out).toContain('_$writeChild');
  });

  it('keeps a site whose spread and ref are nobody’s local', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
const attrs = { title: 'fixed' };
const keep = (node) => node;
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <p {...attrs} ref={keep}>{n}</p>;
  };
});
`);
    expect(out).toContain('_$site(');
    expect(out).toContain('_$writeChild');
  });

  it('builds a site again when its spread or its ref is the run’s', () => {
    const spread = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const attrs = { title: state.value };
    return <p {...attrs}>x</p>;
  };
});
`);
    expect(spread).not.toContain('_$site(');

    const ref = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    const keep = (node) => [node, n];
    return <p ref={keep}>x</p>;
  };
});
`);
    expect(ref).not.toContain('_$site(');
  });

  it('builds a site again when the run’s ref is on a nested element', () => {
    // The refusal belongs to the whole template, not to the element carrying
    // the ref: the site is the root, and keeping it would keep a descendant
    // whose ref holds one run's value for ever.
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    const keep = (node) => [node, n];
    return <section><p ref={keep}>x</p></section>;
  };
});
`);
    expect(out).not.toContain('_$site(');
  });

  it('keeps the site when only the list’s data is the run’s, and feeds it a cell', () => {
    // Issue #40. This is the shape people write — compute at the top of the
    // run, render below — and it used to refuse the site, which rebuilt the
    // whole table on every run and lost every row's identity with it.
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const rows = state.value.rows;
    return <ul>{rows.map((row) => <li key={row.id}>{row.n}</li>)}</ul>;
  };
});
`);
    expect(out).toContain('_$site(');
    // The data reaches the list through a cell the run writes, so the list is
    // made once and reconciles afterwards.
    expect(out).toContain('_$cell(');
    expect(out).toMatch(/_\$list\(\s*\(\)\s*=>\s*_data\$\d+\.value/);
  });

  it('builds a site again when the list’s row is the run’s', () => {
    // Not the data this time but the row: the callback closes over a value
    // that belongs to one run, and a list made once would call it for ever
    // with whatever the first run saw. That one still refuses the site.
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const suffix = state.value.suffix;
    return <ul>{props.rows.map((row) => <li key={row.id}>{row.n}{suffix}</li>)}</ul>;
  };
});
`);
    expect(out).not.toContain('_$site(');
  });

  it('builds a site again when the list’s key is the run’s', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const salt = state.value.salt;
    return <ul>{props.rows.map((row) => <li key={row.id + salt}>{row.n}</li>)}</ul>;
  };
});
`);
    expect(out).not.toContain('_$site(');
  });

  it('leaves a list whose data is not the run’s alone', () => {
    // Nothing here belongs to the run, so the source thunk is already live and
    // a cell would be a signal standing in the way of a read.
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component((props) => {
  return () => <ul>{props.rows.map((row) => <li key={row.id}>{row.n}</li>)}</ul>;
});
`);
    expect(out).toContain('_$site(');
    expect(out).not.toContain('_$cell(');
  });

  it('reads a property name and an object key as spellings, not as names', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const value = state.value;
    return <p title={other.value} data-x={{ value: 1 }.value}>{value}</p>;
  };
});
`);
    // `other.value` and `{ value: 1 }.value` mention `value` only as a
    // spelling, so neither is mistaken for the run's own `value`.
    expect(out).toContain('_$bind(');
  });
});

describe('runs, the last few shapes', () => {
  it('compiles markup that stands outside every function', () => {
    const out = compile(`export const fixed = <p>fixed</p>;`);
    expect(out).toContain('_$template');
  });

  it('keeps nested host elements inside a run', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return (
      <div>
        <section>
          <span>{n}</span>
        </section>
      </div>
    );
  };
});
`);
    expect(out).toContain('_$site(');
    expect(out).toContain('_$writeChild');
  });

  it('attaches a handler that belongs to the run on every run', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <button onClick={() => save(n)}>go</button>;
  };
});
`);
    // Inside the site, but not inside the block that only runs once.
    const once = out.indexOf('_$close(');
    const attach = out.indexOf('_$on(');
    expect(attach).toBeGreaterThan(once);
  });
});

describe('a key is asked of the row, not of what the row is made of', () => {
  it('accepts a keyed row whose own markup has none', () => {
    expect(() =>
      compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return (
      <div>
        {[0, 1, 2].map((row) => (
          <section key={row}>
            <span />
            <span>{n}</span>
          </section>
        ))}
      </div>
    );
  };
});
`),
    ).not.toThrow();
  });

  it('still refuses the row itself', () => {
    expect(() =>
      compile(`
import { component } from '@firsthandjs/dom';
export const Panel = component(() => {
  return () => {
    const n = state.value;
    return <div>{[0, 1, 2].map((row) => <section><span>{n}</span></section>)}</div>;
  };
});
`),
    ).toThrow(/appears many times/);
  });
});

describe('a child of a fragment a run returns', () => {
  it('gets a site, like a child the run returns on its own', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Head, Frame } from './parts.js';
export const View = component(() => () => {
  if (status.value === 'loading') return <Skeleton />;
  return <><Head /><Frame>hi</Frame></>;
});
`);
    // Two components in the fragment and one in the early return: three sites,
    // where the fragment's two used to be made again on every run (#47).
    expect(out.match(/_kept\$\d+\.last = _\$part/g)).toHaveLength(3);
  });

  it('is fed the run’s own locals through a cell', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Frame } from './parts.js';
export const View = component(() => () => {
  const label = status.value;
  return <><Frame title={label} /></>;
});
`);
    expect(out).toContain('_$cell(');
    expect(out).toMatch(/_kept\$\d+\.last = _\$part/);
  });

  it('leaves a list’s rows to the list', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './parts.js';
export const View = component(() => () => {
  const rows = data.value;
  return <><ul>{rows.map((row) => <Row key={row.id} row={row} />)}</ul></>;
});
`);
    // The row belongs to the callback the author wrote, which the list calls
    // per row. What is made once is the `<ul>` around it and the list itself,
    // which now reads its data from a cell the run writes.
    expect(out).toMatch(/_\$list\(\(\) => _data\$\d+\.value/);
    expect(out).not.toMatch(/_kept\$\d+\.last = _\$part\(\(\) => _\$createComponent\(Row/);
  });

  it('leaves a keyed list standing directly in the fragment alone', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Row } from './parts.js';
export const View = component(() => () => {
  const rows = data.value;
  return <><h1>rows</h1>{rows.map((row) => <Row key={row.id} row={row} />)}</>;
});
`);
    // A list is emitted as `part(list)` rather than `part(() => …)`: there is
    // no wrapper to see through, and the rows are the list's business.
    expect(out).toMatch(/_\$part\(_\$list\(/);
  });

  it('keeps a fragment’s child out of it when the fragment is built once', () => {
    const out = compile(`
import { component } from '@firsthandjs/dom';
import { Box, Head } from './parts.js';
export const View = component(() => () => {
  const label = status.value;
  return <Box title={label}><><Head /></></Box>;
});
`);
    // The fragment is inside a child the run keeps, so it is made once and
    // its own children with it: the thunk around them is not a place the run
    // reaches again, and a site there would be numbered by a run that never
    // visits it.
    expect(out.match(/_kept\$\d+\.last = _\$part/g)).toHaveLength(1);
  });
});
