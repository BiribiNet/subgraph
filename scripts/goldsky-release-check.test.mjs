import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseTarget, privateEndpoint, assertCandidate, assertMarkets, runReleaseCheck } from './goldsky-release-check.mjs';
import { BRB_PROJECT_ID } from './goldsky-project.mjs';
test('release and recovery choices cannot select another chain or arbitrary versions', () => {
  assert.equal(releaseTarget('mainnet', 'promote', '1.1.0', '1.0.0').name, 'biribi-arbitrum-one');
  assert.equal(releaseTarget('testnet', 'restore-testnet', 'validation-restore-20261017').chainId, 421614);
  for (const args of [['mainnet','restore-testnet','1.1.0'], ['other','inspect','1.1.0'], ['mainnet','promote','1.1.0'], ['testnet','promote','1.1.0','1.1.0'], ['mainnet','inspect','../prod']]) assert.throws(() => releaseTarget(...args));
});
test('private queries cannot send a key to another origin, project, name or version', () => {
  const expected = `/api/private/${BRB_PROJECT_ID}/subgraphs/biribi-arbitrum-one/1.1.0/gn`;
  assert.equal(privateEndpoint('biribi-arbitrum-one', {version:'1.1.0',private_graphql_endpoint:expected}), 'https://api.goldsky.com'+expected);
  for (const path of ['https://evil.example'+expected, expected+'?key=bad', expected.replace('1.1.0','prod'),expected.replace(BRB_PROJECT_ID,'other'),expected.replace('biribi-arbitrum-one','biribi')]) assert.throws(() => privateEndpoint('biribi-arbitrum-one',{version:'1.1.0',private_graphql_endpoint:path}));
});
test('health, full synchronization and private-only access are mandatory', () => {
  const healthy = { health:'healthy',synced:true,public_endpoint_enabled:false,private_endpoint_enabled:true,deployments:[{}] };
  assert.doesNotThrow(() => assertCandidate(healthy));
  for (const change of [{synced:false},{health:'failed'},{public_endpoint_enabled:true},{private_endpoint_enabled:false},{deployments:[]},{deployments:[{fatal_error:'bad'}]},{deployments:[{non_fatal_errors:['bad']}]}]) assert.throws(() => assertCandidate({...healthy,...change}));
});
test('missing, duplicate, wrong and cross-market assets or banks fail reconciliation', () => {
  const manifest={markets:{brb:{marketId:1,asset:'0x1111',bank:'0xaaaa'},usdc:{marketId:2,asset:'0x2222',bank:'0xbbbb'}}};
  const markets=Object.values(manifest.markets);
  assert.doesNotThrow(()=>assertMarkets(markets,manifest));
  for (const data of [[],[markets[0],markets[0]],[markets[1],{...markets[0],bank:'0xbbbb'}],[markets[1],{...markets[0],asset:'0x2222'}]]) assert.throws(()=>assertMarkets(data,manifest));
});

function fixture({ changedProd = false, drift = false, wrongMarket = false, network = 'mainnet', prodMissing = false, placementMissing = false } = {}) {
  const market = { marketId:1,asset:'0x1111',bank:'0xaaaa' };
  const manifest = { markets: { brb: market } };
  const name=network==='mainnet'?'biribi-arbitrum-one':'biribi';
  const entry = version => ({ version, health:'healthy',synced:true,public_endpoint_enabled:false,private_endpoint_enabled:true,deployments:[{}],
    private_graphql_endpoint:`/api/private/${BRB_PROJECT_ID}/subgraphs/${name}/${version}/gn` });
  const writes=[], runs=[], reports=[];
  let lists=0, promoted=false;
  const fetcher=async(url, options={}) => {
    let data;
    if (url.endsWith('/projects')) data={ data:[{ projectId:BRB_PROJECT_ID,name:'brb',currentlyAuthenticated:true }] };
    else if (url.endsWith('/deployments')) {
      lists++;
      data={data:[entry('1.0.0'),entry('1.1.0'),...(prodMissing&&!promoted?[]:[{...entry('prod'),tag:{target_version: changedProd && lists>1 ? '1.0.1' : promoted ? '1.1.0':'1.0.0'}}])]};
    } else if (url.endsWith('/rpc')) data={result:'0x'+(network==='mainnet'?42161:421614).toString(16)};
    else if (options.method==='PUT') { writes.push(url); if(url.endsWith('/tags/prod')) promoted=true; data={}; }
    else {
      const candidate=url.includes('/1.1.0/') || (url.includes('/prod/') && promoted);
      data={data:{_meta:{deployment:candidate?'candidate':'live',hasIndexingErrors:false,block:{number:123}},markets:[wrongMarket?{...market,bank:'0xbbbb'}:market],roulettePlacements:placementMissing?[]:[{id:'0x1',transactionHash:'0x'+'a'.repeat(64)}]}};
    }
    return {ok:true,json:async()=>data};
  };
  return {writes,runs,reports,dependencies:{fetcher,readManifest:()=>manifest,writeReport:report=>reports.push(report),execute:(_node,args,options)=>{
    runs.push({args,env:options.env}); if(drift && args[0].includes('reconcile')) throw Error('Vault balance drift');
  }}};
}
const env={RELEASE_NETWORK:'mainnet',RELEASE_OPERATION:'promote',VERSION:'1.1.0',EXPECTED_LIVE_VERSION:'1.0.0',GOLDSKY_API_TOKEN:'credential'};
test('mainnet promotion requires comparison and exact vault reconciliation before one private tag move',async()=>{
  const f=fixture(); const report=await runReleaseCheck(env,f.dependencies);
  assert.equal(report.promoted,true);
  assert.deepEqual(f.runs.map(run=>run.args),[['scripts/validate-deploy.mjs','1.0.0','1.1.0'],['scripts/reconcile-vaults.mjs','deployments/arbitrum-one.json']]);
  assert.equal(f.runs[1].env.TOLERANCE,'0');
  assert.equal(f.runs[1].env.RPC_URL,'https://arb1.arbitrum.io/rpc');
  assert.equal(f.writes.filter(url=>url.endsWith('/tags/prod')).length,1);
});
test('wrong markets, vault drift and a concurrently changed prod prevent every tag write',async()=>{
  for(const options of [{wrongMarket:true},{drift:true},{changedProd:true}]) {
    const f=fixture(options); await assert.rejects(runReleaseCheck(env,f.dependencies));
    assert.equal(f.writes.length,0);
    assert.equal(f.reports.at(-1).promoted,false);
  }
});
test('Sepolia recovery only recreates a missing alias after receipts and zero-drift reconciliation',async()=>{
  const f=fixture({network:'testnet',prodMissing:true});
  const report=await runReleaseCheck({...env,RELEASE_NETWORK:'testnet',RELEASE_OPERATION:'restore-testnet'},f.dependencies);
  assert.equal(report.promoted,true);
  assert.deepEqual(f.runs.map(run=>run.args),[['scripts/reconcile-vaults.mjs','deployments/arbitrum-sepolia.json']]);
  assert.equal(f.writes.filter(url=>url.endsWith('/tags/prod')).length,1);
});
test('Sepolia recovery cannot overwrite an alias or publish without placement receipts',async()=>{
  for(const options of [{network:'testnet'},{network:'testnet',prodMissing:true,placementMissing:true}]) {
    const f=fixture(options);
    await assert.rejects(runReleaseCheck({...env,RELEASE_NETWORK:'testnet',RELEASE_OPERATION:'restore-testnet'},f.dependencies));
    assert.equal(f.writes.length,0);
  }
});
