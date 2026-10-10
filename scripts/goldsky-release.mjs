#!/usr/bin/env node
// Release phase 1 only. Never promotes or deletes a deployed version.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { goldskyToken, verifyBrbProject, validateReleaseTarget, assertBuildNetwork } from './goldsky-project.mjs';
import { readFileSync } from 'node:fs';
const name = process.env.GOLDSKY_SUBGRAPH_NAME || 'biribi';
const version = process.env.VERSION;
validateReleaseTarget(name, version);
if (process.env.PRUNE === '1') throw new Error('Automatic pruning is disabled; preserve rollback and testnet deployments.');
const root = fileURLToPath(new URL('..', import.meta.url));
assertBuildNetwork(name, readFileSync(new URL('../subgraph.yaml', import.meta.url), 'utf8'));
await verifyBrbProject(goldskyToken());
for (const task of ['check:constants', 'codegen', 'build']) execFileSync('yarn', [task], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/goldsky-deploy.mjs', `${name}/${version}`], { cwd: root, stdio: 'inherit' });
