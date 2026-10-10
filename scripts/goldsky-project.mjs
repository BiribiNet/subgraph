import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Confirmed in deployments/address-sync-2026-10-09.md.
export const BRB_PROJECT_ID = 'project_cmfbfxud380il01v04gey3ym6';
export const API_BASE = 'https://api.goldsky.com';

export function goldskyToken(env = process.env) {
  const configured = env.GOLDSKY_API_TOKEN?.trim() || env.GOLDSKY_TOKEN?.trim();
  if (configured) return configured;
  const file = join(homedir(), '.goldsky', 'auth_token');
  const token = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (!token) throw new Error('Set GOLDSKY_API_TOKEN or log in to the BRB Goldsky project.');
  return token;
}

export function assertProjectResponse(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('Cannot verify Goldsky project identity.');
  const active = payload.data.filter(project => project.currentlyAuthenticated === true);
  if (active.length !== 1 || active[0].projectId !== BRB_PROJECT_ID || active[0].name !== 'brb') {
    throw new Error(`Refusing Goldsky action: token must authenticate project brb (${BRB_PROJECT_ID}).`);
  }
  return { projectId: BRB_PROJECT_ID, name: 'brb' };
}

export async function verifyBrbProject(token, fetcher = fetch) {
  try {
    const response = await fetcher(`${API_BASE}/api/admin/project/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error();
    return assertProjectResponse(await response.json());
  } catch {
    // Transport exceptions and response bodies can contain credentials.
    throw new Error(`Goldsky BRB project verification failed; no mutation sent. Expected ${BRB_PROJECT_ID}.`);
  }
}

export function validateReleaseTarget(name, version) {
  if (!['biribi', 'biribi-arbitrum-one'].includes(name) || !/^(?:\d+\.\d+\.\d+|validation-[a-z0-9][a-z0-9-]{0,90})$/.test(version ?? '')) {
    throw new Error('Use biribi/<version> for existing testnet or biribi-arbitrum-one/<version> for mainnet; version must be immutable.');
  }
}

export function assertBuildNetwork(name, manifest) {
  const expected = name === 'biribi-arbitrum-one' ? 'arbitrum-one' : 'arbitrum-sepolia';
  const networks = [...manifest.matchAll(/^\s+["']?network["']?:\s*["']?([a-z0-9-]+)["']?\s*$/gm)].map(match => match[1]);
  if (!networks.length || networks.some(network => network !== expected)) {
    throw new Error(`Refusing cross-environment deployment: ${name} requires every source/template on ${expected}.`);
  }
}
