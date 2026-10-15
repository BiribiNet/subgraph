import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function run(operation, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'receipt-release-test-'));
  const preload = join(directory, 'fetch.mjs');
  writeFileSync(preload, `
    globalThis.fetch = async (url, options={}) => {
      url=String(url);
      if (options.method === 'PUT' || options.method === 'DELETE') throw new Error('unexpected mutation');
      let data;
      if(url.endsWith('/api/admin/project/v1/projects')) data=[{currentlyAuthenticated:true,projectId:'project_cmfbfxud380il01v04gey3ym6',name:'brb'}];
      else if(url.endsWith('/api/admin/subgraph/v1/subgraphs/biribi/deployments')) data=[{version:'validation-test',health:'healthy',synced:process.env.TEST_SYNCED==='true',private_endpoint_enabled:true,private_graphql_endpoint:'/api/public/private-test/gn',deployments:[{indexing_progress:{progress_percent:100,deployment_head_block:100}}]}];
      else if(url==='https://biribi.net/api/subgraph') return Response.json({data:{_meta:{deployment:'live-hash',block:{number:100},hasIndexingErrors:false}}});
      else if(url==='https://api.goldsky.com/api/public/private-test/gn') return Response.json({data:{_meta:{deployment:'candidate-hash',block:{number:100},hasIndexingErrors:false},roulettePlacements:[{id:'0x01',amount:'1',transactionHash:'0x02',bet:{id:'0x03'},user:{id:'0x04'},market:{id:'1',bank:'0x05',assetSymbol:'USDC',assetDecimals:6}}]}});
      else throw new Error('unexpected request');
      return Response.json({data});
    };
  `);
  try {
    const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,resolve('scripts/receipt-release.mjs')],{cwd:directory,encoding:'utf8',env:{...process.env,GOLDSKY_API_TOKEN:'test-only-secret',RELEASE_OPERATION:operation,VERSION:'validation-test',EXPECTED_LIVE_DEPLOYMENT:'wrong-hash',TEST_SYNCED:'false',...overrides}});
    assert.equal(result.error,undefined,result.error?.message);
    if (!result.stdout.includes('receiptSample')) assert.fail(result.stderr || 'Release report missing');
    const report=readFileSync(join(directory,'receipt-release-status.json'),'utf8');
    return {...result,report};
  } finally {rmSync(directory,{recursive:true,force:true});}
}
test('inspection reports receipt availability without disclosing credentials or private endpoints',()=>{
  const result=run('inspect');
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.report).receiptSample.length,1);
  assert.doesNotMatch(result.report+result.stdout,/test-only-secret|private-test/);
});
test('an unsynchronized candidate cannot reach validation or promotion',()=>{
  const result=run('promote');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Candidate is not healthy, synchronized/);
});
test('a changed public deployment blocks promotion before reconciliation',()=>{
  const result=run('promote',{TEST_SYNCED:'true'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Public deployment changed/);
});
