import { createHash } from 'node:crypto';

export function credential(env = process.env) {
  const token = env.GOLDSKY_API_TOKEN?.trim() || env.GOLDSKY_TOKEN?.trim();
  if (!token) throw new Error('Configure the GitHub Actions secret GOLDSKY_API_TOKEN before staging.');
  return token;
}

export function validateTarget(name, version) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name ?? '') || !/^validation-[a-z0-9][a-z0-9-]{0,90}$/.test(version ?? '')) {
    throw new Error('Usage: goldsky-stage <name> validation-<unique-id>; public tags are not accepted.');
  }
}

export async function submitValidation({ name, version, token, bundle }, fetcher = fetch) {
  validateTarget(name, version);
  if (!token?.trim()) throw new Error('Goldsky credential is unavailable.');
  if (!bundle?.byteLength) throw new Error('Validation bundle is empty.');
  const form = new FormData();
  form.set('bundle', new Blob([bundle], { type: 'application/octet-stream' }), 'bundle.zip');
  for (const key of ['overwrite', 'remove_graft', 'skip_graft_validation']) form.set(key, '0');
  form.set('description', 'Validation only; full reindex; no production alias change');
  let response;
  try {
    response = await fetcher(`https://api.goldsky.com/api/admin/subgraph/v1/subgraphs/${name}/deployments/${version}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form,
      signal: AbortSignal.timeout(120000), redirect: 'error',
    });
  } catch {
    // Never print transport errors: they can contain authorization headers.
    throw new Error(`Submission status unknown for ${name}/${version}. Inspect Goldsky before retrying; no automatic retry was sent.`);
  }
  if (!response.ok) throw new Error(`Deployment not confirmed (HTTP ${response.status}). Inspect ${name}/${version} before retrying.`);
  let data;
  try { data = (await response.json()).data; } catch {
    throw new Error(`Submission status unknown for ${name}/${version}: unreadable response. Inspect Goldsky before retrying.`);
  }
  // Do not persist arbitrary server text, URLs or credentials in public artifacts.
  const allowedHealth = ['healthy', 'unhealthy', 'failed'];
  return {
    name, version, submission: 'accepted', indexingVerified: false,
    health: allowedHealth.includes(data?.health) ? data.health : null,
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    productionAliasChanged: false,
  };
}
