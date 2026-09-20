/** Read-only, paginated evidence at one indexed block. Prints a portable JSON report. */
const round = process.argv[2];
if (!/^\d+$/.test(round ?? '')) throw new Error('Usage: node scripts/round-evidence.mjs <round>');
const endpoint = process.env.SUBGRAPH_URL ?? 'https://biribi.net/api/subgraph';
async function query(query) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(endpoint).origin }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors.map(e=>e.message).join('; '));
  return result.data;
}
const meta = (await query('{ _meta { block { number hash } hasIndexingErrors } }'))._meta;
if (meta.hasIndexingErrors) throw new Error('Indexing errors: evidence cannot be certified');
const block = meta.block.number;
const global = (await query(`{ globalRounds(block:{number:${block}},where:{roundNumber:"${round}"}) { id roundNumber status requestId vrfTxHash winningNumber jackpotNumber jackpotTriggered vrfResultAt resolvedAt forceResolved } }`)).globalRounds[0];
if (!global) throw new Error('Round not indexed');
async function pages(entity, where, fields) {
  const rows=[]; let cursor='';
  for (;;) {
    const result=await query(`{ ${entity}(block:{number:${block}},first:1000,orderBy:id,orderDirection:asc,where:{${where},id_gt:"${cursor}"}) { id ${fields} } }`);
    const page=result[entity]; rows.push(...page);
    if(page.length<1000) return rows;
    cursor=page[page.length-1].id;
  }
}
const slices=await pages('rouletteRounds',`globalRound:"${global.id}"`,'market { id asset assetSymbol assetDecimals bank } totalBets totalPayouts jackpotRevenue infraRevenue stakersRevenue');
const markets=[]; let valid=true;
for (const slice of slices) {
  const payouts=await pages('payoutTransactions',`round:"${slice.id}"`,'amount user { id } transactionHash blockNumber');
  const jackpot=await pages('jackpotPayouts',`round:"${slice.id}"`,'amount user { id } transactionHash blockNumber');
  const sum=payouts.reduce((v,p)=>v+BigInt(p.amount),0n);
  const delta=sum-BigInt(slice.totalPayouts);
  if(delta!==0n) valid=false;
  markets.push({...slice, payoutReceipts:payouts, jackpotReceipts:jackpot, payoutReceiptDrift:delta.toString()});
}
console.log(JSON.stringify({ version:1, source:endpoint, indexedBlock:meta.block, round:global, markets, reconciledIndexedPayouts:valid,
  limitations:['Indexed receipts are compared with indexed payout progress; this is not an independent on-chain audit.', 'Legacy jackpot market attribution can be ambiguous for multi-market winners.', 'Amounts remain in their token units. Jackpot receipts are BRB.'] },null,2));
if(!valid) process.exitCode=1;
