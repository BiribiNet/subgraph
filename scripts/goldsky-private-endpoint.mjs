import { API_BASE, goldskyToken, verifyBrbProject, validateReleaseTarget } from './goldsky-project.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Goldsky creates public endpoints by default. Restrict and verify before use. */
export async function securePrivateEndpoint(name, version, token, fetcher = fetch) {
  validateReleaseTarget(name, version === 'prod' ? '1.0.0' : version);
  await verifyBrbProject(token, fetcher);
  try {
    // Endpoint/field names match the official Goldsky CLI subgraph update API.
    const response = await fetcher(`${API_BASE}/api/admin/subgraph/v1/subgraph/${name}/deployment/${version}/update`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_endpoint_enabled: false, private_endpoint_enabled: true }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error();
    const readback = await fetcher(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${name}/deployments`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!readback.ok) throw new Error();
    const entry = (await readback.json()).data?.find(item => item.version === version);
    if (entry?.public_endpoint_enabled !== false || entry?.private_endpoint_enabled !== true) throw new Error();
  } catch {
    throw new Error(`Private endpoint configuration unconfirmed for ${name}/${version}. Inspect the BRB dashboard before use; no deployment retry or deletion was sent.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, extra] = process.argv.slice(2);
  const [name, version, trailing] = (target ?? '').split('/');
  if (extra || trailing) throw new Error('Usage: goldsky-private-endpoint.mjs <name>/<version-or-prod>');
  await securePrivateEndpoint(name, version, goldskyToken());
  console.log(`Private-only endpoint verified: ${name}/${version}`);
}
