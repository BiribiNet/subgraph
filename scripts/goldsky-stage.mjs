/** Deploy an immutable validation version; never moves tags or deletes deployments. */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [name, version] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name ?? '') || !/^validation-[a-z0-9-]+$/.test(version ?? '')) {
  throw new Error('Usage: node scripts/goldsky-stage.mjs <name> validation-<unique-id>');
}
const token = process.env.GOLDSKY_API_TOKEN || process.env.GOLDSKY_TOKEN;
if (!token) throw new Error('Goldsky credential is unavailable in this environment');
if (!existsSync('build/subgraph.yaml')) throw new Error('Build the subgraph first');
const bundle = resolve(`.goldsky-${version}.zip`);
try {
  execFileSync('zip', ['-q', '-r', bundle, '.'], { cwd: resolve('build'), stdio: 'inherit' });
  const form = new FormData();
  form.set('bundle', new Blob([readFileSync(bundle)], { type: 'application/octet-stream' }), 'bundle.zip');
  form.set('overwrite', '0');
  form.set('remove_graft', '0');
  form.set('skip_graft_validation', '0');
  form.set('description', 'Validation only; full reindex; no production alias change');
  const response = await fetch(`https://api.goldsky.com/api/admin/subgraph/v1/subgraphs/${name}/deployments/${version}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Deployment not confirmed (HTTP ${response.status}); inspect Goldsky before retrying`);
  const result = await response.json();
  console.log(JSON.stringify({ name, version, health: result.data?.health, endpoint: result.data?.graphql_endpoint }));
} finally {
  rmSync(bundle, { force: true });
}
