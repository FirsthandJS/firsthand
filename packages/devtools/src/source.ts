/**
 * Turning a generated position back into the one that was written.
 *
 * `new Error().stack` reports where code is, not where it came from: browsers
 * do not apply source maps to `error.stack`, so a frame names a line in the
 * compiled module. In a framework that compiles JSX into templates and thunks,
 * that line is nothing the author recognises — which makes a call stack in a
 * panel worse than none, because it looks authoritative.
 *
 * So the map is read here. It is already in the served module, as an inline
 * comment, which is why this needs no build step and no second request beyond
 * the module itself.
 */

/** One entry of a decoded map: a generated position and where it came from. */
interface Mapping {
  generatedLine: number;
  generatedColumn: number;
  source: string;
  originalLine: number;
  originalColumn: number;
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes one base64-VLQ group into its signed numbers. */
function decode(group: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (const character of group) {
    const digit = CHARS.indexOf(character);
    const more = digit & 32;
    value += (digit & 31) << shift;
    if (more === 0) {
      const negative = value & 1;
      value >>= 1;
      values.push(negative === 1 ? -value : value);
      shift = 0;
      value = 0;
    } else {
      shift += 5;
    }
  }
  return values;
}

/** Every mapping of a source map, in the order the format lists them. */
function parse(raw: { mappings: string; sources: (string | null)[] }): Mapping[] {
  const found: Mapping[] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const [generatedLine, group] of raw.mappings.split(';').entries()) {
    let generatedColumn = 0;
    for (const segment of group.split(',')) {
      if (segment === '') {
        continue;
      }
      const fields = decode(segment);
      generatedColumn += fields[0] as number;
      if (fields.length < 4) {
        // A generated position with nothing behind it: code the compiler
        // invented, such as a hoisted template.
        continue;
      }
      source += fields[1] as number;
      originalLine += fields[2] as number;
      originalColumn += fields[3] as number;
      const from = raw.sources[source];
      if (from === null || from === undefined) {
        // The format allows a source to be unnamed. Without a file to point
        // at, a position is not worth reporting.
        continue;
      }
      found.push({
        generatedLine,
        generatedColumn,
        source: from,
        originalLine,
        originalColumn,
      });
    }
  }
  return found;
}

/** Modules already fetched, so a stack of six frames is at most six requests. */
const maps = new Map<string, Promise<Mapping[] | null>>();

const INLINE =
  /\/\/[#@]\s*sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([\w+/=]+)/;

async function mapFor(url: string): Promise<Mapping[] | null> {
  const known = maps.get(url);
  if (known !== undefined) {
    return known;
  }
  const pending = (async (): Promise<Mapping[] | null> => {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const inline = INLINE.exec(text);
      if (inline === null) {
        return null;
      }
      const raw = JSON.parse(atob(inline[1] as string)) as {
        mappings: string;
        sources: (string | null)[];
      };
      return parse(raw);
    } catch {
      // A module that cannot be fetched or read is simply not resolvable. A
      // debugging tool that throws while explaining something is no use.
      return null;
    }
  })();
  maps.set(url, pending);
  return pending;
}

/** The last mapping at or before a generated position. */
function lookup(mappings: Mapping[], line: number, column: number): Mapping | null {
  let best: Mapping | null = null;
  for (const mapping of mappings) {
    if (mapping.generatedLine > line) {
      break;
    }
    if (mapping.generatedLine === line && mapping.generatedColumn > column) {
      break;
    }
    if (mapping.generatedLine === line) {
      best = mapping;
    }
  }
  return best;
}

/**
 * Rewrites a stack frame to the position that was written.
 *
 * `handleSave (http://host/src/order.ts:31:7)` becomes
 * `handleSave (order.ts:12:9)` — the line the author would find by opening the
 * file. A frame that cannot be resolved is handed back unchanged rather than
 * guessed at.
 */
export async function original(frame: string): Promise<string> {
  // Everything up to the last `file:line:column`. A URL contains colons and
  // slashes of its own, so the position is found from the end rather than the
  // scheme from the start.
  const parts = /^(.*?)\(?([^\s()]+):(\d+):(\d+)\)?$/.exec(frame.trim().replace(/^at\s+/, ''));
  if (parts === null) {
    return frame;
  }
  const [, name, url, line, column] = parts as unknown as [string, string, string, string, string];
  if (!/^https?:\/\//.test(url)) {
    // A map is fetched from the page, so only a module the page loaded can be
    // resolved. Anything else — a file path, an engine-internal name — is left
    // alone rather than turned into a request that cannot succeed.
    return frame;
  }
  const mappings = await mapFor(url);
  if (mappings === null) {
    return frame;
  }
  // Stacks count from one; maps count from zero.
  const found = lookup(mappings, Number(line) - 1, Number(column) - 1);
  if (found === null) {
    return frame;
  }
  const file = found.source.slice(
    Math.max(found.source.lastIndexOf('/'), found.source.lastIndexOf('\\')) + 1,
  );
  const where = `${file}:${String(found.originalLine + 1)}:${String(found.originalColumn + 1)}`;
  return name.trim() === '' ? where : `${name.trim()} (${where})`;
}

/** Forgets what has been fetched. For tests, and for a page that reloaded. */
export function forget(): void {
  maps.clear();
}
