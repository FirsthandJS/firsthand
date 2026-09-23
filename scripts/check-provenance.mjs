/**
 * Asserts that what a release workflow just published carries provenance.
 *
 * The release publishes with `npm publish --provenance`, which asks npm to
 * sign a statement saying which commit and which workflow built the tarball.
 * Asking is not the same as getting: for thirteen releases nothing checked,
 * and nothing was getting it — every release run failed at the publish step
 * and the packages went out by hand instead (#50).
 *
 * So it is read back from the registry rather than trusted. A release that
 * published without provenance fails here, loudly, while whoever ran it is
 * still watching. It is the last step of `release.yml` and is meant to be run
 * after a publish; run by hand against a hand-published version it will fail,
 * correctly, because a hand publish has no provenance to find.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A name and a version this script is willing to put in a URL.
 *
 * The two come out of a file, and a file is not a thing to build a request
 * from unchecked — so the shape is stated rather than escaped. Both are what
 * this repository publishes and nothing else.
 */
const PACKAGE = /^@firsthandjs\/[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/;

/** The published manifest, read the way a consumer's installer reads it. */
async function published(name, version) {
  if (!PACKAGE.test(name) || !VERSION.test(version)) {
    throw new Error(`not a name and version this script will request: ${name}@${version}`);
  }
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return undefined;
  }
  return await response.json();
}

let failed = false;
for (const directory of readdirSync(`${root}/packages`)) {
  const local = JSON.parse(readFileSync(`${root}/packages/${directory}/package.json`, 'utf8'));
  if (local.private === true) {
    continue;
  }
  const { name, version } = local;
  const manifest = await published(name, version);
  if (manifest === undefined) {
    console.error(`${name}@${version} is not on the registry`);
    failed = true;
    continue;
  }
  if (manifest.dist?.attestations?.provenance === undefined) {
    console.error(`${name}@${version} was published without provenance`);
    failed = true;
    continue;
  }
  console.log(`${name}@${version} carries provenance`);
}

if (failed) {
  console.error(
    '\nEvery package claims `publishConfig.provenance`. A release that cannot ' +
      'keep that claim is a release that should not be announced: see #50.',
  );
}
process.exitCode = failed ? 1 : 0;
