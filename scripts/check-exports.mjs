/**
 * Package export tests.
 *
 * Imports each published entry point exactly as a consumer would — through the
 * `exports` map of the built package, not through a source alias — and checks
 * that the advertised API is actually there and that the declaration files
 * exist. A broken `exports` map is invisible to the unit tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

const expectations = [
  {
    pkg: 'core',
    entry: '.',
    names: [
      'signal',
      'computed',
      'effect',
      'batch',
      'untrack',
      'onCleanup',
      'createRoot',
      'catchError',
      'createContext',
      'provide',
      'useContext',
    ],
  },
  {
    pkg: 'dom',
    entry: '.',
    names: [
      'component',
      'defineElement',
      'setElementPrefix',
      'setComponentAdapter',
      'render',
      'portal',
      'list',
      'on',
      'off',
      'signal',
    ],
  },
  {
    pkg: 'dom',
    entry: './internal',
    names: ['template', 'insert', 'on', 'list', 'createComponent', 'PROTOCOL_VERSION'],
  },
  { pkg: 'jsx-runtime', entry: '.', names: ['jsx', 'jsxs', 'Fragment'] },
  {
    pkg: 'query',
    entry: '.',
    names: [
      'createQueryClient',
      'useQuery',
      'useMutation',
      'useQueryClient',
      'tag',
      'json',
      'useGraphQL',
      'FirsthandHttpError',
    ],
  },
  { pkg: 'query', entry: './vite', names: ['graphql', 'inlineImports'] },
  { pkg: 'query', entry: './codegen', names: ['plugin'] },
  {
    pkg: 'styled',
    entry: '.',
    names: ['styled', 'css', 'keyframes', 'createGlobalStyle', 'ThemeContext', 'useTheme'],
  },
  { pkg: 'react', entry: '.', names: ['fromReact', 'ReactHost'] },
  // A side-effect module: it exports nothing and installs the adapter.
  { pkg: 'react', entry: './auto', names: [] },
  {
    pkg: 'router',
    entry: '.',
    names: [
      'Router',
      'Outlet',
      'Link',
      'NavLink',
      'Navigate',
      'useRouter',
      'useNavigate',
      'useRouteParams',
      'route',
    ],
  },
  {
    pkg: 'testing',
    entry: '.',
    names: ['mount', 'cleanup', 'autoCleanup', 'withRoot', 'subscriberCount', 'tick'],
  },
  { pkg: 'compiler', entry: '.', names: ['transform', 'firsthandPlugin', 'stableId'] },
  { pkg: 'compiler', entry: './vite', names: ['firsthand'] },
];

for (const { pkg, entry, names } of expectations) {
  const base = resolve(root, 'packages', pkg);
  const manifest = JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8'));
  const mapping = manifest.exports?.[entry];
  if (mapping === undefined) {
    console.error(`${manifest.name} does not export "${entry}"`);
    failed = true;
    continue;
  }

  for (const [condition, file] of Object.entries(mapping)) {
    const path = resolve(base, file);
    if (!existsSync(path)) {
      console.error(`${manifest.name} "${entry}" ${condition} points at a missing file: ${file}`);
      failed = true;
    }
  }

  const module = await import(pathToFileURL(resolve(base, mapping.default)).href);
  const missing = names.filter((name) => module[name] === undefined);
  if (missing.length > 0) {
    console.error(`${manifest.name} "${entry}" is missing: ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`${manifest.name} "${entry}": ${names.length} exports present`);
  }

  for (const field of ['repository', 'bugs', 'homepage', 'license', 'files', 'engines']) {
    if (manifest[field] === undefined) {
      console.error(`${manifest.name} is missing the "${field}" field`);
      failed = true;
    }
  }
  // `false` for a package that is pure, or a list naming exactly the modules
  // that are not — `@firsthandjs/react/auto` installs an adapter, which is the
  // whole point of importing it, and a bundler that dropped it would break the
  // application silently.
  const sideEffects = manifest.sideEffects;
  const declared =
    sideEffects === false ||
    (Array.isArray(sideEffects) && sideEffects.every((entry) => typeof entry === 'string'));
  if (!declared) {
    console.error(
      `${manifest.name} must declare "sideEffects": false, or list the modules that have them`,
    );
    failed = true;
  }
}

// An installed package whose JSX types are missing is a package whose users
// see `JSX element implicitly has type 'any'` on every tag. They live in the
// entry module so that tsc always emits them; this checks that it did.
const jsxEntry = resolve(root, 'packages', 'jsx-runtime', 'dist', 'index.d.ts');
if (!readFileSync(jsxEntry, 'utf8').includes('namespace JSX')) {
  console.error('@firsthandjs/jsx-runtime ships no JSX types: consumers get no element typing');
  failed = true;
} else {
  console.log('@firsthandjs/jsx-runtime: JSX types are published with the package');
}

process.exitCode = failed ? 1 : 0;
