/** Independently verify indexed payment receipts against public transaction logs. */
import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-sepolia.json', import.meta.url), 'utf8'));
const rpcUrl = process.env.RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const lower = value => String(value).toLowerCase();
async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
if (BigInt(await rpc('eth_chainId', [])) !== 421614n) throw new Error('Expected Arbitrum Sepolia');
const block = await rpc('eth_getBlockByNumber', ['0x'+BigInt(evidence.indexedBlock.number).toString(16), false]);
if (!block || lower(block.hash) !== lower(evidence.indexedBlock.hash)) throw new Error('Indexed block is unavailable or differs from RPC; do not certify this evidence');
const used = new Set();
const receipts = new Map();
let verified = 0;
async function verify(row, from, token) {
  const hash=lower(row.transactionHash);
  if(!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid transaction hash');
  let receipt=receipts.get(hash);
  if(!receipt) { receipt=await rpc('eth_getTransactionReceipt',[hash]); receipts.set(hash,receipt); }
  if(!receipt || BigInt(receipt.status)!==1n || BigInt(receipt.blockNumber)>BigInt(evidence.indexedBlock.number)) throw new Error('Payment is not confirmed at the evidence block');
  if(BigInt(receipt.blockNumber)!==BigInt(row.blockNumber)) throw new Error('Indexed payment block differs from transaction receipt');
  const log=receipt.logs.find(log=>!log.removed && !used.has(hash+'/'+log.logIndex) && lower(log.address)===lower(token) &&
    lower(log.topics[0])===TRANSFER && lower('0x'+log.topics[1]?.slice(-40))===lower(from) &&
    lower('0x'+log.topics[2]?.slice(-40))===lower(row.user.id) && BigInt(log.data)===BigInt(row.amount));
  if(!log) throw new Error(`No distinct matching token transfer for ${row.id}`);
  used.add(hash+'/'+log.logIndex); verified++;
}
for(const market of evidence.markets) {
  const config=Object.values(deployment.markets).find(config=>String(config.marketId)===market.market.id);
  if(!config || lower(config.bank)!==lower(market.market.bank) || lower(config.asset)!==lower(market.market.asset)) throw new Error('Market does not match deployment catalog');
  for(const row of market.payoutReceipts) await verify(row,config.bank,config.asset);
  for(const row of market.jackpotReceipts) await verify(row,deployment.addresses.jackpotTreasury,deployment.addresses.brb);
}
console.log(JSON.stringify({round:evidence.round.roundNumber,block:evidence.indexedBlock,verifiedTokenTransfers:verified,
  scope:'Token transfer verification only; does not validate VRF cryptography, completeness of the index, or jackpot eligibility.'},null,2));
