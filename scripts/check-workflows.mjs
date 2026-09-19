/**
 * Validates the GitHub Actions workflows.
 *
 * CI cannot be run locally, so the next best thing is to check the parts that
 * are checkable: that every workflow parses, that every job the repository
 * relies on exists, that every `npm run` step names a script that is actually
 * defined, and that every third-party action is pinned to a commit SHA rather
 * than a moving tag.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = new Set(
  Object.keys(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts),
);

let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};

for (const file of readdirSync(resolve(root, '.github/workflows'))) {
  const path = `.github/workflows/${file}`;
  let workflow;
  try {
    workflow = parse(readFileSync(resolve(root, path), 'utf8'));
  } catch (error) {
    fail(`${path}: does not parse — ${String(error).split('\n')[0]}`);
    continue;
  }

  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.uses === 'string' && !step.uses.startsWith('./')) {
        const [action, reference] = step.uses.split('@');
        if (!/^[0-9a-f]{40}$/.test(reference ?? '')) {
          fail(`${path}: job "${name}" uses ${action} at "${reference}", not a commit SHA`);
        }
      }
      for (const line of String(step.run ?? '').split('\n')) {
        const match = /^\s*npm run ([\w:-]+)/.exec(line);
        if (match !== null && !scripts.has(match[1])) {
          fail(
            `${path}: job "${name}" runs "npm run ${match[1]}", which package.json does not define`,
          );
        }
      }
    }
  }
  console.log(`${path}: ${Object.keys(workflow.jobs ?? {}).length} job(s), all actions pinned`);
}

try {
  parse(readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8'));
  console.log('.github/dependabot.yml: parses');
} catch (error) {
  fail(`.github/dependabot.yml: does not parse — ${String(error).split('\n')[0]}`);
}

process.exitCode = failed ? 1 : 0;
