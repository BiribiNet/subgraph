// Phase 2 only: operator must first review reconciliation and governance impact.
import { API_BASE, goldskyToken, verifyBrbProject, validateReleaseTarget } from './goldsky-project.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function promoteRelease(name, version, token, fetcher = fetch) {
  validateReleaseTarget(name, version);
  const target = `${name}/${version}`;
  await verifyBrbProject(token, fetcher);
  let response;
  try {
    response = await fetcher(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${name}/deployments`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    const entry = payload.data?.find(item => item.version === version);
    if (!entry || entry.health !== 'healthy' || entry.synced !== true || !entry.deployments?.length
        || entry.deployments.some(deployment => deployment.fatal_error || deployment.non_fatal_errors?.length)) {
      throw new Error();
    }
  } catch {
    throw new Error('Candidate health/synchronization could not be verified; prod is unchanged.');
  }
  try {
    response = await fetcher(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${name}/tags/prod`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_version: version }), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(`Promotion status unknown for ${target}; inspect the BRB dashboard before retrying.`);
}
if (!response.ok) throw new Error(`Promotion unconfirmed (HTTP ${response.status}); inspect BRB project before retrying.`);
console.log(`Promoted ${target} to ${name}/prod. All older deployments retained. Verify the alias and application before cutover.`);

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, acknowledgement] = process.argv.slice(2);
  const [name, version, extra] = (target || '').split('/');
  validateReleaseTarget(name, version);
  if (extra || acknowledgement !== '--validated') throw new Error('Usage: goldsky-promote.mjs <name>/<version> --validated. First review same-block reconciliation and all runbook gates.');
  await promoteRelease(name, version, goldskyToken());
}
