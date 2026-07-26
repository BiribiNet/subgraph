/**
 * Guard: src/helpers/constant.ts addresses must match the deployment JSON.
 *
 * The mappings compare raw event addresses against JACKPOT_TREASURY_ADDRESS
 * (jackpot-payout detection) and BRB_TOKEN_ADDRESS (BRB market classification,
 * donation tracking). A stale value silently produces wrong data — no crash —
 * so this check runs in `yarn test` and fails loudly on drift.
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

if (failed) process.exit(1);
console.log(`check-constants: src/helpers/constant.ts matches ${deployJson}`);
