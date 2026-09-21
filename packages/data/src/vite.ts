/**
 * Importing `.graphql` and `.gql` files.
 *
 * Build-time only: an import becomes the parsed document — fragments inlined,
 * tags read, directives stripped — so neither the parser nor the cache's
 * directives ever reach the browser, and a malformed directive fails the build
 * rather than a page.
 *
 * ```ts
 * // vite.config.ts
 * import { graphql } from '@firsthandjs/data/vite';
 * export default defineConfig({ plugins: [graphql()] });
 * ```
 *
 * ```ts
 * import NotesQuery from './notes.gql';
 * const notes = useGraphQL(NotesQuery); // typed, given the codegen below
 * ```
 *
 * Without `@firsthandjs/data/codegen`, declare the module shape once:
 *
 * ```ts
 * declare module '*.gql' {
 *   const document: import('@firsthandjs/data').GraphQLDocument;
 *   export default document;
 * }
 * ```
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseGraphQL } from './document.js';

interface TransformResult {
  code: string;
  map: null;
}

export interface GraphQLPlugin {
  name: string;
  enforce: 'pre';
  transform(this: unknown, code: string, id: string): TransformResult | null;
}

const IMPORT = /^#\s*import\s+(['"])(.+?)\1/gm;
const DOCUMENT = /\.(graphql|gql)(\?.*)?$/;

/**
 * Inlines `#import "./fragments.gql"`, the convention every GraphQL loader
 * uses.
 *
 * A fragment lives in one file and is used by several operations, and the
 * server has to be sent the fragment along with the operation that spreads it
 * — so the import is resolved here rather than at runtime, where the file
 * system is not available and the cost would be per page load.
 *
 * Each file is included once however many times it is imported, and a cycle
 * terminates for the same reason.
 */
export function inlineImports(
  source: string,
  file: string,
  seen: Set<string> = new Set([file]),
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  const imported: string[] = [];
  const body = source.replace(IMPORT, (_whole, _quote: string, specifier: string) => {
    const path = resolve(dirname(file), specifier);
    if (!seen.has(path)) {
      seen.add(path);
      imported.push(inlineImports(read(path), path, seen, read));
    }
    return '';
  });
  return imported.length === 0 ? body : `${imported.join('\n')}\n${body}`;
}

export function graphql(): GraphQLPlugin {
  return {
    name: 'firsthand-graphql',
    enforce: 'pre',
    transform(code: string, id: string): TransformResult | null {
      const file = id.split('?')[0] as string;
      if (!DOCUMENT.test(id)) {
        return null;
      }
      const document = parseGraphQL(inlineImports(code, file));
      return {
        code: `export default ${JSON.stringify(document)};`,
        map: null,
      };
    },
  };
}
