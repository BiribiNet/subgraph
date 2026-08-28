/**
 * Guard: src/helpers/constant.ts AND subgraph.yaml must match the deployment JSON.
 *
 * The mappings compare raw event addresses against JACKPOT_TREASURY_ADDRESS
 * (jackpot-payout detection) and BRB_TOKEN_ADDRESS (BRB market classification,
 * donation tracking). A stale value silently produces wrong data — no crash —
 * so this check runs in `yarn test` and fails loudly on drift.
 *
 * The manifest needs the same guard, for a sharper reason: sync-pipeline patches
 * subgraph.yaml with `String.replace`, which is a silent no-op when its regex
 * stops matching (a formatting change is enough). Nothing downstream notices —
 * codegen, build and deploy all succeed against the stale address. Checking the
 * manifest here catches that, and equally a skipped sync run or a hand edit,
 * whatever the cause. It matters most before a re-index from startBlock, which
 * bakes whatever the manifest says into the whole rebuilt history.
 *
 * Usage: node scripts/check-constants.mjs [deployments/arbitrum-sepolia.json]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployJson = process.argv[2] ?? "deployments/arbitrum-sepolia.json";
const deploy = JSON.parse(readFileSync(resolve(root, deployJson), "utf8"));
const constantTs = readFileSync(
  join(root, "src", "helpers", "constant.ts"),
  "utf8",
);
const subgraphYaml = readFileSync(join(root, "subgraph.yaml"), "utf8");

function constantValue(name) {
  const match = constantTs.match(
    new RegExp(
      `export const ${name} = Address\\.fromString\\(\\s*"(0x[a-fA-F0-9]{40})"\\s*\\)`,
    ),
  );
  if (!match) {
    console.error(`check-constants: ${name} not found in src/helpers/constant.ts`);
    process.exit(1);
  }
  return match[1].toLowerCase();
}

const checks = [
  ["JACKPOT_TREASURY_ADDRESS", deploy.addresses?.jackpotTreasury],
  ["BRB_TOKEN_ADDRESS", deploy.addresses?.brb],
];

let failed = false;
for (const [name, expected] of checks) {
  if (!expected) {
    console.error(`check-constants: ${deployJson} is missing the expected address for ${name}`);
    failed = true;
    continue;
  }
  const actual = constantValue(name);
  if (actual !== String(expected).toLowerCase()) {
    console.error(
      `check-constants: ${name} is stale — constant.ts has ${actual}, ${deployJson} has ${expected}. Run sync:pipeline or update constant.ts.`,
    );
    failed = true;
  }
}

/**
 * Manifest data source -> deployment JSON key. Mirrors `dsMap` in sync-pipeline.mjs;
 * templates (BankVault, MarketAsset) are deliberately absent — they carry no address
 * or startBlock and are spawned per market from MarketRegistered.
 */
const DATA_SOURCE_KEYS = [
  ["BRBToken", "brb"],
  ["RouletteEngine", "roulette"],
  ["BRBReferral", "brbReferal"],
  ["BRBJackpotFunder", "jackpotFunder"],
  ["SideBet", "sideBet"],
  ["AutomationReceiver", "automationReceiver"],
  ["UpkeepScheduler", "scheduler"],
  ["CreExecutionAuthority", "creExecutionAuthority"],
];

/** Reads one data source's `address` and `startBlock` out of the manifest. */
function manifestSource(name) {
  const match = subgraphYaml.match(
    new RegExp(
      `name: ${name}\\n(?:.*\\n)*?      address: "(0x[a-fA-F0-9]{40})"[^\\n]*\\n      startBlock: (\\d+)`,
    ),
  );
  return match ? { address: match[1].toLowerCase(), startBlock: Number(match[2]) } : null;
}

/** Falls back the way sync-pipeline's blockFor() does, so both agree on the expected value. */
function expectedStartBlock(key) {
  const override = deploy.startBlocks?.[key];
  return Number(override ?? deploy.startBlock);
}

for (const [name, key] of DATA_SOURCE_KEYS) {
  const expectedAddress = deploy.addresses?.[key];
  if (!expectedAddress) {
    console.error(`check-constants: ${deployJson} has no addresses.${key} for data source ${name}`);
    failed = true;
    continue;
  }

  const source = manifestSource(name);
  if (!source) {
    console.error(
      `check-constants: data source ${name} not found in subgraph.yaml, or its address/startBlock could not be read`,
    );
    failed = true;
    continue;
  }

  if (source.address !== String(expectedAddress).toLowerCase()) {
    console.error(
      `check-constants: subgraph.yaml ${name} address is stale — manifest has ${source.address}, ${deployJson} has ${expectedAddress}. Run sync:pipeline.`,
    );
    failed = true;
  }

  const expectedBlock = expectedStartBlock(key);
  if (!Number.isFinite(expectedBlock)) {
    console.error(`check-constants: ${deployJson} has no startBlock for ${key}`);
    failed = true;
  } else if (source.startBlock !== expectedBlock) {
    console.error(
      `check-constants: subgraph.yaml ${name} startBlock is stale — manifest has ${source.startBlock}, ${deployJson} resolves ${expectedBlock}. Run sync:pipeline.`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(
  `check-constants: src/helpers/constant.ts and subgraph.yaml match ${deployJson} (${DATA_SOURCE_KEYS.length} data sources)`,
);
