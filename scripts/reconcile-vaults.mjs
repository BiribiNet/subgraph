/**
 * Ops check: every market's indexed vault balance must match the chain.
 *
 * `Market.totalAssets` is not read from the vault — it is accumulated from
 * events (`grossVaultBalance − lockedBetLiquidity`, see src/helpers/vault-ledger.ts).
 * A mapping bug, or history left behind by an older deployed mapping, therefore
 * shows up as a silent drift: the API keeps answering, the numbers are simply
 * wrong. Share price and every APY snapshot are derived from `totalAssets`, so a
 * drift propagates straight into the staking UI.
 *
 * This compares, per market, the indexed `totalAssets` / `totalShares` against
 * `totalAssets()` / `totalSupply()` on the vault, read at the exact block the
 * subgraph has indexed so the comparison is not racing the chain.
 *
 * Run it after a re-index and whenever the staking figures look off. It reads
 * only public data and mutates nothing.
 *
 * Usage:
 *   node scripts/reconcile-vaults.mjs [deployments/arbitrum-sepolia.json]
 *
 * Env:
 *   SUBGRAPH_URL — GraphQL endpoint (default: https://biribi.net/api/subgraph)
 *   RPC_URL      — JSON-RPC endpoint (default: https://sepolia-rollup.arbitrum.io/rpc)
 *   TOLERANCE    — allowed absolute drift in raw asset units (default: 0)
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployJson = process.argv[2] ?? "deployments/arbitrum-sepolia.json";
const deploy = JSON.parse(readFileSync(resolve(root, deployJson), "utf8"));

const subgraphUrl = process.env.SUBGRAPH_URL ?? "https://biribi.net/api/subgraph";
const rpcUrl = process.env.RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
const tolerance = BigInt(process.env.TOLERANCE ?? "0");

// ERC-4626 totalAssets() and ERC-20 totalSupply() selectors.
const TOTAL_ASSETS_SELECTOR = "0x01e1d114";
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";

async function graphql(query) {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The public proxy rejects requests without a same-origin marker.
      Origin: new URL(subgraphUrl).origin,
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json();
  if (payload.errors) {
    throw new Error(`subgraph: ${payload.errors.map((e) => e.message).join("; ")}`);
  }
  return payload.data;
}

async function rpcHeadBlock() {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`rpc eth_blockNumber: ${payload.error.message}`);
  return Number(BigInt(payload.result));
}

/** eth_call pinned to `blockNumber` so the vault is read as of the compared head. */
async function ethCall(to, data, blockNumber) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, `0x${blockNumber.toString(16)}`],
    }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`rpc ${to}: ${payload.error.message}`);
  return BigInt(payload.result);
}

function formatUnits(value, decimals) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

// Pin both sides to one height, or the comparison races settlement. The indexed
// head and the RPC head drift apart in both directions — the subgraph can be
// behind, and a public RPC can lag or prune blocks the subgraph already has — so
// compare at whichever is lower and time-travel the subgraph query to it.
const [meta, headBlock] = await Promise.all([
  graphql("{ _meta { block { number } } }"),
  rpcHeadBlock(),
]);
const indexedBlock = meta._meta.block.number;
const block = Math.min(indexedBlock, headBlock);

const data = await graphql(`{
  markets(orderBy: marketId, block: { number: ${block} }) {
    marketId
    assetSymbol
    assetDecimals
    bank
    totalAssets
    totalShares
    brbDonations
  }
}`);

const markets = data.markets;
if (markets.length === 0) {
  console.error("reconcile-vaults: the subgraph reports no markets");
  process.exit(1);
}

const knownBanks = new Set(
  (deploy.addresses?.banks ?? []).map((bank) => bank.toLowerCase()),
);

console.log(
  `reconcile-vaults: ${markets.length} markets at block ${block}` +
    (block === indexedBlock ? "" : ` (indexed head ${indexedBlock} is ahead of the RPC)`),
);
let failed = false;

for (const market of markets) {
  const bank = market.bank.toLowerCase();
  const label = `market ${market.marketId} (${market.assetSymbol})`;

  if (knownBanks.size > 0 && !knownBanks.has(bank)) {
    console.error(`  ${label}: bank ${bank} is not in ${deployJson} addresses.banks`);
    failed = true;
  }

  const [onchainAssets, onchainShares] = await Promise.all([
    ethCall(bank, TOTAL_ASSETS_SELECTOR, block),
    ethCall(bank, TOTAL_SUPPLY_SELECTOR, block),
  ]);

  const assetDrift = BigInt(market.totalAssets) - onchainAssets;
  const shareDrift = BigInt(market.totalShares) - onchainShares;
  const absAssetDrift = assetDrift < 0n ? -assetDrift : assetDrift;
  const absShareDrift = shareDrift < 0n ? -shareDrift : shareDrift;

  if (absAssetDrift <= tolerance && absShareDrift === 0n) {
    console.log(
      `  ${label}: ok — totalAssets ${formatUnits(onchainAssets, market.assetDecimals)}`,
    );
    continue;
  }

  failed = true;
  if (absAssetDrift > tolerance) {
    console.error(
      `  ${label}: totalAssets drift ${formatUnits(assetDrift, market.assetDecimals)} ` +
        `— indexed ${formatUnits(BigInt(market.totalAssets), market.assetDecimals)}, ` +
        `chain ${formatUnits(onchainAssets, market.assetDecimals)}`,
    );
    // The usual culprit: inbound transfers booked as donations. It is the one
    // component of grossVaultBalance that no vault event ever reverses.
    if (BigInt(market.brbDonations) !== 0n) {
      console.error(
        `    brbDonations is ${formatUnits(BigInt(market.brbDonations), market.assetDecimals)} — ` +
          `compare it with the drift above before suspecting the vault handlers`,
      );
    }
  }
  if (absShareDrift !== 0n) {
    console.error(
      `  ${label}: totalShares drift ${shareDrift} — indexed ${market.totalShares}, chain ${onchainShares}`,
    );
  }
}

if (failed) {
  console.error(
    "reconcile-vaults: drift detected. If the mapping has changed since the live deploy, " +
      "re-index from startBlock before treating this as a code bug.",
  );
  process.exit(1);
}
console.log("reconcile-vaults: every market matches the chain");
