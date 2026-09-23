/**
 * Asserts that what was just published carries the attestation it claims.
 *
 * Every manifest says `publishConfig.provenance: true`, which is a
 * supply-chain claim: this tarball was built from this commit, by this
 * workflow, and here is the signature to check it with. The claim was false
 * for thirteen releases — every release run failed at the publish step and the
 * packages went out by hand instead, where provenance is not merely absent but
 * has to be switched off with `--provenance=false` before npm will publish at
 * all (#50).
 *
 * So the claim is read back from the registry rather than trusted. A release
 * that published without provenance fails here, loudly, while whoever ran it
 * is still watching.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The published manifest, read the way a consumer's installer reads it. */
async function published(name, version) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`;
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
