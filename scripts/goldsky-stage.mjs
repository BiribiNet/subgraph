/** Deploy an immutable validation version; never moves tags or deletes deployments. */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, rmdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credential, validateTarget, submitValidation } from './goldsky-stage-client.mjs';

const [name, version] = process.argv.slice(2);
validateTarget(name, version);
const token = credential();
if (!existsSync('build/subgraph.yaml')) throw new Error('Build the subgraph first');
const temporary = mkdtempSync(join(tmpdir(), 'biribi-validation-'));
const bundle = join(temporary, 'bundle.zip');
try {
  execFileSync('zip', ['-q', '-r', bundle, '.'], { cwd: resolve('build'), stdio: 'inherit' });
  const result = await submitValidation({ name, version, token, bundle: readFileSync(bundle) });
  writeFileSync('staging-submission.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  rmSync(bundle, { force: true });
  rmdirSync(temporary);
}
