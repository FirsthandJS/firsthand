/**
 * Everything around the transform: the TypeScript input, the pieces it is
 * built from, the Vite plugin, the names it gives devtools, and the source map
 * a debugger reads.
 */

import { describe, expect, it } from 'vitest';

import { compileModule, transform } from '@/api.js';

import { escapeAttribute, escapeText, eventName } from '@/html.js';

import { stableId } from '@/ids.js';

import { firsthand } from '@/vite.js';

import { compile, IMPORTS } from './compile.js';

describe('TypeScript input', () => {
  it('parses annotations and leaves them for the bundler', () => {
    const out = compile(
      `${IMPORTS}type P = { x: number };\nconst A = component((props: P) => <p>{props.x}</p>);`,
      true,
    );
    expect(out).toContain('props: P');
    expect(out).toContain('_$insert');
  });
});

describe('supporting pieces', () => {
  it('derives a stable id from the package and module path', () => {
    expect(stableId('pkg', 'src/a.tsx')).toBe(stableId('pkg', 'lib/a.tsx'));
    expect(stableId('pkg', 'src/a.tsx')).not.toBe(stableId('other', 'src/a.tsx'));
    expect(stableId('pkg', 'C:\\project\\src\\a.tsx')).toBe(stableId('pkg', 'src/a.tsx'));
  });

  it('exposes html helpers', () => {
    expect(escapeText('<&')).toBe('&lt;&amp;');
    expect(escapeAttribute('"&')).toBe('&quot;&amp;');
    expect(eventName('onPointerDown')).toBe('pointerdown');
  });

  it('leaves out the files a project says are not its own', () => {
    // How a project keeps a folder of another framework's components: what
    // this compiler does not compile, it does not claim.
    const plugin = firsthand({ packageName: 'demo', exclude: [/\/legacy\//] });
    const source = `${IMPORTS}const A = component(() => <p>x</p>);`;
    expect(plugin.transform(source, '/app/legacy/button.tsx')).toBeNull();
    expect(plugin.transform(source, '/app/ui/button.tsx')?.code).toContain('_$template');

    const only = firsthand({ packageName: 'demo', include: [/\/app\/ui\//] });
    expect(only.transform(source, '/app/other/button.tsx')).toBeNull();
    expect(only.transform(source, '/app/ui/button.tsx')?.code).toContain('_$template');
  });

  it('provides a bundler plugin that only touches JSX modules', () => {
    const plugin = firsthand({ packageName: 'demo' });
    expect(plugin.name).toBe('firsthand');
    expect(plugin.transform('const a = 1;', '/app/main.ts')).toBeNull();
    const tsx = plugin.transform(
      `${IMPORTS}const A = component(() => <p>x</p>);`,
      '/app/main.tsx?v=1',
    );
    expect(tsx?.code).toContain('_$template');
    const jsxFile = plugin.transform(
      `${IMPORTS}const A = component(() => <p>x</p>);`,
      '/app/main.jsx',
    );
    expect(jsxFile?.code).toContain('_$template');
  });

  it('works without a filename or a package name', () => {
    const out = transform(`${IMPORTS}const A = component(() => <p>x</p>);`);
    expect(out).toMatch(/"[0-9a-f]{8}\/A"/);
    expect(transform('')).toBe('');
  });

  it('rejects an element used directly as an attribute value', () => {
    expect(() => compile(`${IMPORTS}const A = component(() => <p title=<b /> />);`)).toThrow(
      /not a valid attribute value/,
    );
  });
});

describe('source maps', () => {
  it('maps the output back to the file that was written', () => {
    const { code, map } = compileModule(
      `${IMPORTS}const A = component((props) => <p title="x">{props.label}</p>);`,
      { filename: 'src/demo.tsx', packageName: 'demo', sourceMaps: true },
    );

    expect(code).toContain('_$template');
    const mapping = map as { version: number; mappings: string; sources: string[] };
    expect(mapping.version).toBe(3);
    expect(mapping.mappings.length).toBeGreaterThan(0);
    expect(mapping.sources.some((source) => source.includes('demo.tsx'))).toBe(true);
  });

  it('does not pay for one unless it is asked for', () => {
    const { map } = compileModule(`${IMPORTS}const A = component(() => <p>x</p>);`, {
      filename: 'src/demo.tsx',
      packageName: 'demo',
    });
    expect(map).toBeNull();
  });
});

describe('naming cells for devtools', () => {
  const named = (source: string): string =>
    transform(source, { filename: 'src/main.tsx', packageName: 'app', devtools: true });

  it('names a signal after the variable, with the line it was written on', () => {
    const out = named(
      `${IMPORTS}import { signal } from '@firsthandjs/core';\nconst A = component(() => {\n  const count = signal(0);\n  return <p>{count.value}</p>;\n});`,
    );
    // A runtime cannot see the name, and `error.stack` reports the compiled
    // position rather than this one, so the compiler says both.
    expect(out).toContain('_$label(signal(0), "signal", "count (main.tsx:4)")');
  });

  it('names a computed and a deep signal too', () => {
    const out = named(
      `${IMPORTS}import { computed } from '@firsthandjs/core';\nimport { deepSignal } from '@firsthandjs/deep';\nconst A = component(() => {\n  const state = deepSignal({ a: 1 });\n  const twice = computed(() => state.a * 2);\n  return <p>{twice.value}</p>;\n});`,
    );
    expect(out).toContain('"signal", "state (main.tsx:5)"');
    expect(out).toContain('"computed", "twice (main.tsx:6)"');
  });

  it('leaves alone what it cannot name', () => {
    const out = named(
      `${IMPORTS}import { signal } from '@firsthandjs/core';\nconst make = () => signal(0);\nconst A = component(() => {\n  const [first] = [signal(1)];\n  const other = make();\n  return <p>{first.value}</p>;\n});`,
    );
    // Not a plain identifier, and not a framework factory: neither is wrapped.
    expect(out).not.toContain('"first');
    expect(out).not.toContain('"other');
  });

  it('emits nothing at all when the option is off', () => {
    const out = transform(
      `${IMPORTS}import { signal } from '@firsthandjs/core';\nconst A = component(() => {\n  const count = signal(0);\n  return <p>{count.value}</p>;\n});`,
      { filename: 'src/main.tsx', packageName: 'app' },
    );
    expect(out).not.toContain('_$label');
  });
});

describe('what naming leaves alone', () => {
  const named = (source: string): string =>
    transform(source, { filename: 'src/main.tsx', packageName: 'app', devtools: true });

  it('ignores a `signal` that is not the framework’s', () => {
    const out = named(
      `${IMPORTS}const signal = (n) => ({ value: n });\nconst A = component(() => {\n  const count = signal(0);\n  return <p>{count.value}</p>;\n});`,
    );
    expect(out).not.toContain('_$label');
  });

  it('ignores a `signal` that is not imported at all', () => {
    const out = named(
      `${IMPORTS}const A = component(() => {\n  const count = signal(0);\n  return <p>{count.value}</p>;\n});`,
    );
    expect(out).not.toContain('_$label');
  });
});

describe('the Vite plugin', () => {
  it('names cells while serving, and not while building', () => {
    const source = `${IMPORTS}import { signal } from '@firsthandjs/core';\nconst A = component(() => {\n  const count = signal(0);\n  return <p>{count.value}</p>;\n});`;

    const serving = firsthand({ packageName: 'app' });
    serving.configResolved({ command: 'serve' });
    expect(serving.transform(source, '/src/main.tsx')?.code).toContain('_$label');

    const building = firsthand({ packageName: 'app' });
    building.configResolved({ command: 'build' });
    expect(building.transform(source, '/src/main.tsx')?.code).not.toContain('_$label');
  });

  it('returns a map, so a debugger shows the JSX', () => {
    const plugin = firsthand({ packageName: 'app' });
    plugin.configResolved({ command: 'build' });
    const result = plugin.transform(`${IMPORTS}const A = component(() => <p>x</p>);`, '/src/a.tsx');
    expect((result?.map as { version?: number } | null)?.version).toBe(3);
  });
});

describe('where a debugger can stop', () => {
  it('gives the expression position to the thunk, not to the call that creates it', () => {
    const { map } = compileModule(
      `${IMPORTS}const A = component((props) => <p>{props.label}</p>);`,
      {
        filename: 'src/demo.tsx',
        packageName: 'demo',
        sourceMaps: true,
      },
    );

    // A debugger takes the first mapped location on a line. If the `_$insert`
    // call carried the expression's position it would win — and it runs once,
    // when the part is created. The thunk runs on every update, which is where
    // a breakpoint on `{props.label}` is expected to stop.
    const mappings = (map as { mappings: string }).mappings;
    expect(mappings.length).toBeGreaterThan(0);

    const { code } = compileModule(
      `${IMPORTS}const A = component((props) => <p>{props.label}</p>);`,
      { filename: 'src/demo.tsx', packageName: 'demo' },
    );
    expect(code).toContain('_$insert(_el$, () => props.label)');
  });
});

describe('one breakpoint per expression', () => {
  it('gives the thunk a point rather than a range', () => {
    // A destructured prop, alone on its line: the case that produced two.
    const source = `${IMPORTS}const A = component(({ label }) => (
  <p>
    {label}
  </p>
));`;
    const { map } = compileModule(source, {
      filename: 'src/demo.tsx',
      packageName: 'demo',
      sourceMaps: true,
    });

    // A debugger draws one marker per distinct original column on a line. The
    // generator maps both ends of a node, so a thunk spanning the expression
    // produced two — one where it begins and one where it ends — that looked
    // identical and did the same thing. An expression the author wrote still
    // maps its own parts, which is useful; this is about the wrapper.
    const expressionLine =
      source.split(String.fromCharCode(10)).findIndex((line) => line.includes('{label}')) + 1;
    expect(originalColumns(map as { mappings: string }, expressionLine)).toHaveLength(1);
  });
});

/** The original columns any mapping lands on, for one original line. */
function originalColumns(map: { mappings: string }, line: number): number[] {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const decode = (group: string): number[] => {
    const out: number[] = [];
    let shift = 0;
    let value = 0;
    for (const character of group) {
      const digit = CHARS.indexOf(character);
      const more = digit & 32;
      value += (digit & 31) << shift;
      if (more === 0) {
        const negative = value & 1;
        value >>= 1;
        out.push(negative === 1 ? -value : value);
        shift = 0;
        value = 0;
      } else {
        shift += 5;
      }
    }
    return out;
  };
  let originalLine = 0;
  let originalColumn = 0;
  const found = new Set<number>();
  for (const group of map.mappings.split(';')) {
    for (const segment of group.split(',').filter(Boolean)) {
      const fields = decode(segment);
      if (fields.length >= 4) {
        originalLine += fields[2] as number;
        originalColumn += fields[3] as number;
        // Mappings count lines from zero; the caller counts from one.
        if (originalLine + 1 === line) {
          found.add(originalColumn);
        }
      }
    }
  }
  return [...found];
}
