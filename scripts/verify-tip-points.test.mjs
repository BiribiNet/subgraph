import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTipPoints } from './verify-tip-points.mjs';
const sender = '0x' + '1'.repeat(40), token = '0x' + '2'.repeat(40), recipient = '0x' + '3'.repeat(40), jar = '0x' + '4'.repeat(40), hash = '0x' + 'a'.repeat(64);
const word = value => value.replace(/^0x/, '').padStart(64, '0'), amount = 10n ** 18n;
function fixture() {
 const tip = { id: hash + '01', jar, sender, token, recipient, amount: String(amount), transactionHash: hash, blockNumber: '90' };
 const user = { id: sender, totalTipsSent: String(amount), tipCount: '1', tipPoints: '3', brbpPoints: '6', totalRouletteBets: String(amount), totalStaked: '0', totalUnstaked: '0', totalBrbrEarned: '0' };
 const data = { _meta: { block: { number: 100, hash }, hasIndexingErrors: false }, tips: [tip], users: [user] };
 const receipt = { status: '0x1', transactionHash: hash, blockNumber: '0x5a', logs: [
   { address: jar, topics: ['0x7034535d23588442e56e6f7a2c0d6c139dec7d61cfdb7e68f094a7cf6b6e0a5b'], data: '0x' + word(sender) + word(token) + word(recipient) + word(amount.toString(16)), logIndex: '0x1' },
   { address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + word(sender), '0x' + word(recipient)], data: '0x' + word(amount.toString(16)) },
 ] };
 const args = { manifest: { addresses: { brb: token, tipJar: jar } }, block: 164,
   graphql: async query => { assert.match(query, /number:100/); return data; },
   rpc: async (method, params) => method === 'eth_getTransactionReceipt' ? receipt : method === 'eth_getBlockByNumber' ? { hash } : '0x' + word(params[0].data === '0x82bfefc8' ? token : recipient),
 };
 return { args, data, receipt, tip, user };
}
test('reconciles exact tips, token transfers, cumulative points and full score at one block', async () => {
 const { args } = fixture();
 assert.deepEqual(await verifyTipPoints(args), { block: 100, blockHash: hash, tipCount: 1, usersChecked: 1, receiptsChecked: 1, rate: '3 BRBpoints per BRB', verified: true });
});
test('rejects wrong points, counters, score, recipients, replayed rows and incomplete scans', async () => {
 const cases = [f => f.user.tipPoints = '4', f => f.user.tipCount = '2', f => f.user.brbpPoints = '7', f => f.tip.recipient = sender, f => f.data.tips.push(f.tip), f => f.data.users = Array(1000).fill(f.user), f => f.data.users = []];
 for (const mutate of cases) { const f = fixture(); mutate(f); await assert.rejects(verifyTipPoints(f.args), /Tip release check:/); }
});
test('rejects removed, reverted, forged or missing source evidence and mismatched blocks', async () => {
 const cases = [f => f.receipt.status = '0x0', f => f.receipt.logs[0].removed = true, f => f.receipt.logs[0].data = '0x', f => f.receipt.logs[1].data = '0x01', f => f.data._meta.block.hash = '0xwrong', f => f.tip.id = hash + '02'];
 for (const mutate of cases) { const f = fixture(); mutate(f); await assert.rejects(verifyTipPoints(f.args), /Tip release check:/); }
});
test('handles unavailable indexed hashes while rejecting a reorg at the pinned chain block', async () => {
 const f = fixture(); f.data._meta.block.hash = null;
 assert.equal((await verifyTipPoints(f.args)).verified, true);
 const original = f.args.rpc; let reads = 0;
 f.args.rpc = async (method, params) => method === 'eth_getBlockByNumber' && ++reads > 1 ? { hash: '0x' + 'b'.repeat(64) } : original(method, params);
 await assert.rejects(verifyTipPoints(f.args), /pinned block changed/);
});
