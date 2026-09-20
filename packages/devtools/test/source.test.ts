/**
 * Turning a compiled position back into the written one.
 *
 * The maps here are built by the real compiler rather than written by hand:
 * what is being tested is whether a frame can be traced back through what this
 * framework actually emits, and a map invented for the test would prove
 * something about the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileModule } from '@firsthandjs/compiler';
import { forget, original } from '../src/source.js';

/** Spelled in pieces: written out, it would be read as this file's own map. */
const MARKER = ['source', 'Mapping', 'URL'].join('');

const SOURCE = `import { component, signal } from '@firsthandjs/dom';

const Counter = component(() => {
  const count = signal(0);
  return <p>{count.value}</p>;
});
`;

/**
 * A module with an inline map, spliced together rather than written out: a
 * literal map comment in this file would be read as this file's own map.
 */
function withMap(map: unknown): string {
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  return `const a = 1;
//# ${MARKER}=data:application/json;base64,${encoded}`;
}

/** The module a development server would serve, map comment and all. */
function served(): string {
  const { code, map } = compileModule(SOURCE, {
    filename: 'src/main.tsx',
    typescript: true,
    packageName: 'app',
    sourceMaps: true,
  });
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
}

/** Where the compiled expression ended up, so the test asks about a real line. */
function generatedPositionOfExpression(): { line: number; column: number } {
  const { code } = compileModule(SOURCE, {
    filename: 'src/main.tsx',
    typescript: true,
    packageName: 'app',
  });
  // The call, not the import of the same name at the top of the module.
  const line = code.split('\n').findIndex((text) => text.includes('_$insert('));
  const column = (code.split('\n')[line] as string).indexOf('_$insert(');
  // Stacks count from one.
  return { line: line + 1, column: column + 1 };
}

let fetched: string[];

beforeEach(() => {
  forget();
  fetched = [];
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url);
    return Promise.resolve({ text: () => Promise.resolve(served()) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  forget();
});

describe('resolving a frame', () => {
  it('reports the line that was written, not the one that was generated', async () => {
    const { line, column } = generatedPositionOfExpression();

    const resolved = await original(`at http://localhost:5173/src/main.tsx:${line}:${column}`);

    // The expression lives on line 5 of the source above; the compiled module
    // puts it somewhere else entirely.
    expect(resolved).toMatch(/^main\.tsx:\d+:\d+$/);
    expect(resolved).not.toBe(`main.tsx:${line}:${column}`);
  });

  it('keeps the function name', async () => {
    const { line, column } = generatedPositionOfExpression();

    const resolved = await original(
      `handleSave (http://localhost:5173/src/main.tsx:${line}:${column})`,
    );

    expect(resolved).toMatch(/^handleSave \(main\.tsx:\d+:\d+\)$/);
  });

  it('reads each module once, however many frames point at it', async () => {
    const { line, column } = generatedPositionOfExpression();
    const frame = `http://localhost:5173/src/main.tsx:${line}:${column}`;

    await Promise.all([original(frame), original(frame), original(frame)]);

    expect(fetched).toHaveLength(1);
  });
});

describe('when it cannot be resolved', () => {
  it('hands back a frame with no position', async () => {
    expect(await original('<anonymous>')).toBe('<anonymous>');
  });

  it('hands back a frame whose module has no map', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ text: () => Promise.resolve('const a = 1;') }));

    const frame = 'http://localhost:5173/src/plain.js:1:1';
    expect(await original(frame)).toBe(frame);
  });

  it('hands back a frame whose module cannot be read', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    const frame = 'http://localhost:5173/src/gone.js:1:1';
    expect(await original(frame)).toBe(frame);
  });

  it('hands back a position the map does not cover', async () => {
    const frame = 'http://localhost:5173/src/main.tsx:9999:1';
    expect(await original(frame)).toBe(frame);
  });

  it('hands back a position on a line the compiler wrote by itself', async () => {
    // Line one of the compiled module is the import the compiler added; the
    // map says nothing about it, and a guess would be worse than silence.
    const frame = 'http://localhost:5173/src/main.tsx:1:1';
    expect(await original(frame)).toBe(frame);
  });

  it('skips a generated position with nothing behind it', async () => {
    // The format allows a segment that only says "here", with no source: a
    // template the compiler invented. The next segment is the real one.
    const module = withMap({ version: 3, sources: ['src/thing.ts'], mappings: 'A,CAAC' });
    vi.stubGlobal('fetch', () => Promise.resolve({ text: () => Promise.resolve(module) }));

    expect(await original('http://localhost:5173/src/thing.js:1:2')).toBe('thing.ts:1:2');
  });

  it('hands back a position whose source the map does not name', async () => {
    // `sources` may hold a null, which the format allows and which leaves
    // nothing to open.
    const module = withMap({ version: 3, sources: [null], mappings: 'AAAA' });
    vi.stubGlobal('fetch', () => Promise.resolve({ text: () => Promise.resolve(module) }));

    const frame = 'http://localhost:5173/src/nameless.js:1:1';
    expect(await original(frame)).toBe(frame);
  });
});
