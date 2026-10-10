#!/usr/bin/env node
// Immutable, untagged submission. Promotion is a separate, reviewed operation.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, goldskyToken, verifyBrbProject, validateReleaseTarget, assertBuildNetwork } from './goldsky-project.mjs';

const [target, ...args] = process.argv.slice(2);
const [name, version, extra] = (target ?? '').split('/');
validateReleaseTarget(name, version);
if (extra || (args.length && (args.length !== 2 || args[0] !== '--description'))) {
  throw new Error('Usage: goldsky-deploy.mjs <name>/<version> [--description text]. Tags cannot move during deployment.');
}
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const build = resolve(process.env.GOLDSKY_BUILD_DIR || join(root, 'build'));
assertBuildNetwork(name, readFileSync(join(build, 'subgraph.yaml'), 'utf8'));
const token = goldskyToken();
await verifyBrbProject(token);
const temp = mkdtempSync(join(tmpdir(), 'biribi-goldsky-'));
try {
  const bundle = join(temp, 'bundle.zip');
  execFileSync('zip', ['-q', '-r', bundle, '.'], { cwd: build, stdio: 'inherit' });
  const form = new FormData();
  form.set('bundle', new Blob([readFileSync(bundle)], { type: 'application/octet-stream' }), 'bundle.zip');
  for (const key of ['overwrite', 'remove_graft', 'skip_graft_validation']) form.set(key, '0');
  if (args[1]) form.set('description', args[1]);
  let response;
  try {
    response = await fetch(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${name}/deployments/${version}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form,
      signal: AbortSignal.timeout(120000), redirect: 'error',
    });
  } catch {
    throw new Error(`Submission status unknown for ${target}; inspect BRB project before retrying. No retry or tag change sent.`);
  }
  if (!response.ok) throw new Error(`Submission not confirmed (HTTP ${response.status}); inspect ${target} before retrying.`);
  console.log(`Accepted ${target} in BRB project. Indexing is unverified; tags and previous versions are unchanged.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
