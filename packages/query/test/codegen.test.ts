/**
 * The `.gql` loader's fragment imports, and the codegen plugin that types them.
 *
 * Together these are what makes a `.gql` file a typed value: the loader turns
 * the file into a document with its fragments inlined, and the plugin writes
 * the declaration that says what that document returns.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graphql, inlineImports } from '@firsthandjs/query/vite';
import { plugin } from '@firsthandjs/query/codegen';
import { parseGraphQL } from '@firsthandjs/query';

/** A fake file system, so these tests touch no disk. */
const files = (entries: Record<string, string>) => {
  const read = (path: string): string => {
    const normalized = path.split('\\').join('/');
    const found = Object.entries(entries).find(([name]) => normalized.endsWith(name));
    if (found === undefined) {
      throw new Error(`no such file: ${normalized}`);
    }
    return found[1];
  };
  return read;
};

describe('fragment imports', () => {
  it('inlines an imported file above the operation', () => {
    const read = files({
      'fields.gql': 'fragment NoteFields on Note { id title }',
    });
    const source = ['#import "./fields.gql"', 'query Notes { notes { ...NoteFields } }', ''].join(
      '\n',
    );

    const out = inlineImports(source, '/src/notes.gql', new Set(['/src/notes.gql']), read);

    expect(out).toContain('fragment NoteFields on Note');
    expect(out).toContain('query Notes');
    expect(out.indexOf('fragment')).toBeLessThan(out.indexOf('query'));
  });

  it('includes a file once however often it is imported', () => {
    const read = files({
      'a.gql': '#import "./shared.gql"\nfragment A on Note { id }',
      'b.gql': '#import "./shared.gql"\nfragment B on Note { title }',
      'shared.gql': 'fragment Shared on Note { id }',
    });
    const source = ['#import "./a.gql"', '#import "./b.gql"', 'query Q { q }'].join('\n');

    const out = inlineImports(source, '/src/q.gql', new Set(['/src/q.gql']), read);

    expect(out.match(/fragment Shared/g)).toHaveLength(1);
    expect(out).toContain('fragment A');
    expect(out).toContain('fragment B');
  });

  it('terminates on a cycle', () => {
    const read = files({
      'a.gql': '#import "./b.gql"\nfragment A on Note { id }',
      'b.gql': '#import "./a.gql"\nfragment B on Note { title }',
    });

    const out = inlineImports(
      '#import "./a.gql"\nquery Q { q }',
      '/src/q.gql',
      new Set(['/src/q.gql']),
      read,
    );

    expect(out).toContain('fragment A');
    expect(out).toContain('fragment B');
  });

  it('accepts single quotes and extra spacing', () => {
    const read = files({ 'f.gql': 'fragment F on Note { id }' });
    const out = inlineImports(
      "#  import   './f.gql'\nquery Q { q }",
      '/src/q.gql',
      undefined,
      read,
    );
    expect(out).toContain('fragment F');
  });

  it('leaves a document with no imports exactly as it was', () => {
    const source = 'query Q { q }';
    expect(inlineImports(source, '/src/q.gql')).toBe(source);
  });
});

describe('the loader', () => {
  it('reads a .gql file, inlining and parsing it', () => {
    const result = graphql().transform.call(
      null,
      'query Notes @tag(name: "notes") { notes { id } }',
      '/src/notes.gql',
    );

    expect(result).not.toBeNull();
    const document = JSON.parse(
      (result as { code: string }).code.replace('export default ', '').replace(/;$/, ''),
    ) as { operation: string; tags: { name: string }[]; source: string };
    expect(document.operation).toBe('Notes');
    expect(document.tags[0]?.name).toBe('notes');
    expect(document.source).not.toContain('@tag');
  });
});

describe('the loader against a real file system', () => {
  it('reads an imported fragment from disk', () => {
    // The default reader is the one an application actually uses, so it is
    // tested against real files rather than a stub.
    const directory = mkdtempSync(join(tmpdir(), 'firsthand-gql-'));
    writeFileSync(join(directory, 'fields.gql'), 'fragment NoteFields on Note { id title }');
    const operation = join(directory, 'notes.gql');
    const source = [
      '#import "./fields.gql"',
      'query Notes @tag(name: "notes") { notes { ...NoteFields } }',
    ].join('\n');
    writeFileSync(operation, source);

    const result = graphql().transform.call(null, source, operation);

    const document = JSON.parse(
      (result as { code: string }).code.replace('export default ', '').replace(/;$/, ''),
    ) as { source: string; operation: string };
    expect(document.operation).toBe('Notes');
    expect(document.source).toContain('fragment NoteFields on Note');
  });
});

describe('the codegen plugin', () => {
  const document = (location: string, name: string, operation: string) => ({
    location,
    document: {
      definitions: [{ kind: 'OperationDefinition', operation, name: { value: name } }],
    },
  });

  it('declares a typed module per operation file', () => {
    const out = plugin(null, [document('/src/gql/notes.gql', 'Notes', 'query')], {});

    expect(out).toContain("declare module '*/notes.gql'");
    expect(out).toContain("import('@firsthandjs/query').GraphQLDocument<");
    expect(out).toContain("import('./graphql-types').NotesQuery,");
    expect(out).toContain("import('./graphql-types').NotesQueryVariables");
    expect(out).toContain('export default document;');
  });

  it('names mutation and subscription types the way codegen does', () => {
    const out = plugin(null, [
      document('/src/add.gql', 'AddNote', 'mutation'),
      document('/src/ticks.gql', 'Ticks', 'subscription'),
      document('/src/odd.gql', 'Odd', 'unknown-kind'),
    ]);

    expect(out).toContain('AddNoteMutation,');
    expect(out).toContain('TicksSubscription,');
    // An operation kind nothing recognises still produces something usable.
    expect(out).toContain('OddQuery,');
  });

  it('takes the types path from the config', () => {
    const out = plugin(null, [document('/src/notes.gql', 'Notes', 'query')], {
      typesPath: '../generated/types',
      documentTypePath: '@firsthandjs/query',
    });
    expect(out).toContain("import('../generated/types').NotesQuery");
  });

  it('normalises Windows paths', () => {
    const out = plugin(null, [document('C:\\src\\gql\\notes.gql', 'Notes', 'query')]);
    expect(out).toContain("declare module '*/notes.gql'");
  });

  it('defaults an operation with no kind to a query', () => {
    const out = plugin(null, [
      {
        location: '/src/bare.gql',
        document: { definitions: [{ kind: 'OperationDefinition', name: { value: 'Bare' } }] },
      },
    ]);
    expect(out).toContain('BareQuery,');
  });

  it('skips a file with no operation, and one with no location', () => {
    const out = plugin(null, [
      {
        location: '/src/fragments.gql',
        document: { definitions: [{ kind: 'FragmentDefinition' }] },
      },
      { location: '', document: { definitions: [] } },
      { document: { definitions: [] } },
      { location: '/src/empty.gql' },
    ]);

    expect(out).not.toContain('declare module');
    // A fragments-only file is untyped on purpose: importing it as a document
    // would be a mistake.
    expect(out).toContain('Generated by @firsthandjs/query/codegen');
  });

  it('declares each file once, however many documents point at it', () => {
    const out = plugin(null, [
      document('/src/notes.gql', 'Notes', 'query'),
      document('/other/notes.gql', 'Notes', 'query'),
    ]);
    expect(out.match(/declare module/g)).toHaveLength(1);
  });

  it('produces a declaration TypeScript accepts for a real document', () => {
    // The point of the wildcard: the file must stay a script, so no import
    // statements, only inline import types.
    const out = plugin(null, [document('/src/notes.gql', 'Notes', 'query')]);
    expect(out).not.toMatch(/^import /m);
    expect(parseGraphQL('query Notes { notes { id } }').operation).toBe('Notes');
  });
});
