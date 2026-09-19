/**
 * Renders `docs/` into a GitHub wiki.
 *
 * The wiki is a second git repository with a flat namespace and no directories,
 * so the pages here are generated rather than written: `docs/` stays the single
 * source, and this turns it into wiki pages with a sidebar.
 *
 * Three things have to be rewritten on the way:
 *
 *  1. **Page names.** `guide/03-components.md` becomes `Components`, because a
 *     wiki page's name is its URL and its title.
 *  2. **Links.** `../adr/0009-....md` and `03-components.md` become wiki page
 *     names; links that point outside `docs/` become absolute URLs into the
 *     repository, since the wiki cannot reach the code.
 *  3. **The sidebar.** `_Sidebar.md` is what makes it read as a wiki rather
 *     than as a pile of pages.
 *
 * Usage: `node scripts/build-wiki.mjs <output-directory>`
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const out = resolve(process.argv[2] ?? join(root, '.wiki'));
const REPO = 'https://github.com/FirsthandJS/firsthand/blob/main';

/** Every markdown file under `docs/`, as paths relative to `docs/`. */
function walk(dir, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, `${prefix}${entry}/`));
    } else if (entry.endsWith('.md')) {
      found.push(`${prefix}${entry}`);
    }
  }
  return found;
}

/** Title-cases a slug: `05-context-and-lifecycle` -> `Context and lifecycle`. */
function titleFromSlug(slug) {
  const words = slug.replace(/^\d+-/, '').split('-');
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * The wiki page name for a docs path.
 *
 * Guide and reference pages keep a prefix so that two pages called `Testing`
 * do not collide — the wiki has one flat namespace.
 */
function pageName(relPath) {
  const slug = basename(relPath, '.md');
  if (relPath === 'README.md') return 'Home';
  if (relPath.startsWith('guide/')) return `Guide ${titleFromSlug(slug)}`;
  if (relPath.startsWith('reference/')) return `API ${slug}`;
  if (relPath.startsWith('adr/')) {
    if (slug === 'README') return 'Decisions';
    const [, number, rest] = /^(\d+)-(.*)$/.exec(slug) ?? [];
    return number === undefined ? titleFromSlug(slug) : `ADR-${number} ${titleFromSlug(rest)}`;
  }
  if (relPath.startsWith('architecture/')) return `Architecture ${titleFromSlug(slug)}`;
  return titleFromSlug(slug);
}

const pages = walk(docs);
const names = new Map(pages.map((path) => [path, pageName(path)]));

/** A wiki link target: page names are URL-encoded with spaces as dashes. */
const wikiHref = (name) => name.replace(/ /g, '-');

/** Rewrites one link found in a page. */
function rewriteLink(target, fromRelPath) {
  if (/^(https?:|mailto:|#)/.test(target)) return target;
  const [path, hash = ''] = target.split('#');
  if (path === '') return target;
  const resolved = relative(docs, resolve(dirname(join(docs, fromRelPath)), path)).replace(
    /\\/g,
    '/',
  );
  // Inside docs/: a wiki page. The trailing directory form (`guide/`) points at
  // the section, which the sidebar covers, so it becomes Home.
  if (names.has(resolved)) return wikiHref(names.get(resolved)) + (hash ? `#${hash}` : '');
  if (resolved === 'guide' || resolved === 'reference' || resolved === 'adr') return 'Home';
  // Outside docs/: the file lives in the repository, so link to it there.
  const outside = relative(root, resolve(dirname(join(docs, fromRelPath)), path)).replace(
    /\\/g,
    '/',
  );
  return `${REPO}/${outside}${hash ? `#${hash}` : ''}`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const path of pages) {
  const source = readFileSync(join(docs, path), 'utf8');
  const rewritten = source.replace(
    /\]\(([^)]+)\)/g,
    (_match, target) => `](${rewriteLink(target, path)})`,
  );
  writeFileSync(join(out, `${names.get(path)}.md`), rewritten);
}

/** The sidebar: the guide in reading order, then the reference, then the rest. */
const guide = pages.filter((p) => p.startsWith('guide/'));
const reference = pages.filter((p) => p.startsWith('reference/'));
const adrs = pages.filter((p) => p.startsWith('adr/') && !p.endsWith('README.md'));
const architecture = pages.filter((p) => p.startsWith('architecture/'));

const list = (paths) =>
  paths
    .map(
      (path) => `- [${names.get(path).replace(/^(Guide|API) /, '')}](${wikiHref(names.get(path))})`,
    )
    .join('\n');

writeFileSync(
  join(out, '_Sidebar.md'),
  `### [Firsthand](Home)

**Guide**

${list(guide)}

**API reference**

${list(reference)}

**Architecture**

${list(architecture)}
- [Decisions (ADRs)](Decisions)

**Elsewhere**

- [Repository](https://github.com/FirsthandJS/firsthand)
- [npm](https://www.npmjs.com/org/firsthandjs)
`,
);

writeFileSync(
  join(out, '_Footer.md'),
  `Generated from [\`docs/\`](${REPO}/docs) — edit the documentation there, not here.\n`,
);

console.log(`${String(pages.length)} pages + sidebar written to ${out}`);
console.log(
  `  guide ${String(guide.length)}, reference ${String(reference.length)}, adr ${String(adrs.length)}, architecture ${String(architecture.length)}`,
);
