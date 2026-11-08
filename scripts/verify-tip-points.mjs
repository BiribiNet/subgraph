// Read-only mainnet release gate. All queries and receipts refer to one indexed block.
const TIP_TOPIC = '0x7034535d23588442e56e6f7a2c0d6c139dec7d61cfdb7e68f094a7cf6b6e0a5b';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const UNIT = 10n ** 18n;
// BRBPointsConfig.challengeWeight default (src/helpers/brb-points.ts): daily-challenge points are
// already whole BRBpoints, added after the divisor like tips (owner decision 2026-11-08).
const CHALLENGE_WEIGHT = 1n;
const lower = value => String(value).toLowerCase();
const address = word => '0x' + word.slice(-40).toLowerCase();
function requireCheck(ok, message) { if (!ok) throw Error('Tip release check: ' + message); }

export async function verifyTipPoints({ graphql, rpc, manifest, block }) {
  requireCheck(Number.isSafeInteger(block) && block > 64, 'missing indexed block');
  const pin = block - 64, blockTag = '0x' + pin.toString(16);
  const jar = lower(manifest.addresses.tipJar), token = lower(manifest.addresses.brb);
  requireCheck(/^0x[\da-f]{40}$/.test(jar), 'missing canonical TipJar');
  const [onchainToken, onchainRecipient] = await Promise.all([
    rpc('eth_call', [{ to: jar, data: '0x82bfefc8' }, blockTag]),
    rpc('eth_call', [{ to: jar, data: '0x0d9019e1' }, blockTag]),
  ]);
  requireCheck(address(onchainToken) === token, 'TipJar token differs from manifest');
  const recipient = address(onchainRecipient);
  const data = await graphql(`{ _meta(block:{number:${pin}}) { block { number hash } hasIndexingErrors }
    tips(first:1000,block:{number:${pin}}) { id jar sender token recipient amount transactionHash blockNumber }
    users(first:1000,block:{number:${pin}}) { id totalTipsSent tipCount tipPoints challengePoints brbpPoints totalRouletteBets totalStaked totalUnstaked totalBrbrEarned } }`);
  requireCheck(data._meta?.block?.number === pin && data._meta.hasIndexingErrors === false, 'index is not healthy at pinned block');
  requireCheck(Array.isArray(data.tips) && Array.isArray(data.users) && data.tips.length < 1000 && data.users.length < 1000, 'scan incomplete; extend pagination before release');
  const chainBlock = await rpc('eth_getBlockByNumber', [blockTag, false]);
  requireCheck(/^0x[\da-f]{64}$/i.test(chainBlock?.hash ?? ''), 'pinned chain block unavailable');
  // Goldsky may return null for a number-pinned _meta hash. Still reject any
  // provided mismatch, verify receipt blocks, and reread the chain pin at the end.
  if (data._meta.block.hash != null) requireCheck(lower(chainBlock.hash) === lower(data._meta.block.hash), 'indexed block hash differs from chain');
  const totals = new Map(), receipts = new Map(), transfers = new Map(), seen = new Set();
  for (const tip of data.tips) {
    requireCheck(!seen.has(tip.id), 'duplicate tip record'); seen.add(tip.id);
    requireCheck(lower(tip.jar) === jar && lower(tip.token) === token && lower(tip.recipient) === recipient, 'unexpected tip deployment, token or recipient');
    const sender = lower(tip.sender), amount = BigInt(tip.amount), hash = lower(tip.transactionHash);
    requireCheck(amount > 0n && sender !== recipient && !/^0x0{40}$/.test(sender), 'ineligible contribution');
    if (!receipts.has(hash)) {
      const receipt = await rpc('eth_getTransactionReceipt', [hash]);
      if (receipt?.blockHash) {
        const sourceBlock = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
        requireCheck(lower(sourceBlock?.hash) === lower(receipt.blockHash), 'receipt block differs from canonical chain');
      }
      receipts.set(hash, receipt);
    }
    const receipt = receipts.get(hash);
    requireCheck(receipt?.status === '0x1' && lower(receipt.transactionHash) === hash && Number(BigInt(receipt.blockNumber)) === Number(tip.blockNumber) && Number(tip.blockNumber) <= pin, 'invalid tip receipt');
    const matches = receipt.logs.filter(log => {
      if (log.removed || lower(log.address) !== jar || lower(log.topics?.[0]) !== TIP_TOPIC || log.topics.length !== 1 || !/^0x[\da-f]{256}$/i.test(log.data)) return false;
      const words = log.data.slice(2).match(/.{64}/g);
      const index = BigInt(log.logIndex).toString(16);
      return lower(tip.id) === hash + index.padStart(index.length + index.length % 2, '0') && address(words[0]) === sender && address(words[1]) === token && address(words[2]) === recipient && BigInt('0x' + words[3]) === amount;
    });
    requireCheck(matches.length === 1, 'missing exact TipSent evidence');
    const total = totals.get(sender) ?? { amount: 0n, count: 0n };
    total.amount += amount; total.count++; totals.set(sender, total);
    const key = hash + ':' + sender;
    transfers.set(key, (transfers.get(key) ?? 0n) + amount);
  }
  for (const [key, expected] of transfers) {
    const [hash, sender] = key.split(':');
    const received = receipts.get(hash).logs.reduce((sum, log) => {
      return !log.removed && lower(log.address) === token && log.topics?.length === 3 && lower(log.topics[0]) === TRANSFER_TOPIC && address(log.topics[1]) === sender && address(log.topics[2]) === recipient ? sum + BigInt(log.data) : sum;
    }, 0n);
    requireCheck(received === expected, 'BRB transfers do not match tips');
  }
  for (const user of data.users) {
    const expected = totals.get(lower(user.id)) ?? { amount: 0n, count: 0n };
    const points = expected.amount * 3n / UNIT;
    requireCheck(BigInt(user.totalTipsSent) === expected.amount && BigInt(user.tipCount) === expected.count && BigInt(user.tipPoints) === points, 'user tip totals or 3x points differ');
    const netStake = BigInt(user.totalStaked) > BigInt(user.totalUnstaked) ? BigInt(user.totalStaked) - BigInt(user.totalUnstaked) : 0n;
    const challenges = BigInt(user.challengePoints) * CHALLENGE_WEIGHT;
    const score = (BigInt(user.totalRouletteBets) * 3n + netStake + BigInt(user.totalBrbrEarned) * 2n) / UNIT + points + challenges;
    requireCheck(BigInt(user.brbpPoints) === score, 'authoritative score differs from approved formula');
    totals.delete(lower(user.id));
  }
  requireCheck(totals.size === 0, 'tip sender missing from users');
  const finalBlock = await rpc('eth_getBlockByNumber', [blockTag, false]);
  requireCheck(lower(finalBlock?.hash) === lower(chainBlock.hash), 'pinned block changed during verification');
  return { block: pin, blockHash: chainBlock.hash, tipCount: data.tips.length, usersChecked: data.users.length, receiptsChecked: receipts.size, rate: '3 BRBpoints per BRB', verified: true };
}
