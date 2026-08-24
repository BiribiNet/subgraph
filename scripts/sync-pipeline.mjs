/**
 * Patch turbo.yaml + turbo-cre.yaml (Goldsky _gs_log_decode ABI + contract addresses)
 * and subgraph.yaml from a deployment JSON, then optionally validate/apply turbo + deploy
 * subgraph (tcg-vault style).
 *
 * Prerequisites: from ../contracts run `yarn update:subgraph:abis` (generates abis/MergedEvents.json).
 *
 * Usage:
 *   DEPLOY_JSON=./deployments/arbitrum-sepolia.json yarn sync:pipeline
 *
 * Env:
 *   DEPLOY_JSON              — path to JSON (required) see deployments/example-arbitrum-sepolia.json
 *                            — optional startBlocks.{brb,roulette,brbReferal,sideBet,jackpotFunder,
 *                              automationReceiver,scheduler,creExecutionAuthority} override startBlock per data source
 *                            — addresses.banks[] (or addresses.markets.*.bank) appended to turbo `WHERE address IN` for vault events
 *                            — optional addresses.upkeepManager, sideBet, jackpotFunder appended to turbo `WHERE address IN`
 *                            — MergedEvents.json is extended with SideBet + BRBJackpotFunder events from abis/*.json
 *   GOLDSKY_SUBGRAPH_NAME    — default biribi
 *   GOLDSKY_SYNC_FILES_ONLY  — if 1, only patch YAML files (no goldsky CLI)
 *   WEBHOOK_SECRET           — required for full sync if turbo.yaml url contains ${WEBHOOK_SECRET}
 *   CRE_WEBHOOK_URL          — required for full sync (turbo-cre.yaml ${CRE_WEBHOOK_URL})
 *                            — CRE turbo uses Goldsky `secret_name: BIRIBI_CRE_SCHEDULE` (httpauth),
 *                              header should be `x-webhook-secret` matching the Worker WEBHOOK_SECRET
 */
import { config } from "dotenv";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

/** Must match turbo.yaml webhook url placeholder (string replace — not a regex). */
const WEBHOOK_SECRET_PLACEHOLDER = "${WEBHOOK_SECRET}";
const CRE_WEBHOOK_URL_PLACEHOLDER = "${CRE_WEBHOOK_URL}";
const addressPlaceholder = "__SYNC_PIPELINE_ADDRESSES__";
const rouletteAddressPlaceholder = "__SYNC_PIPELINE_ROULETTE_ADDRESS__";
const abiPlaceholder = "__SYNC_PIPELINE_ABI__";

function injectPlaceholder(turbo, placeholder, value, label) {
  if (!turbo.includes(placeholder)) return turbo;
  const out = turbo.replaceAll(placeholder, value);
  if (out.includes(placeholder)) {
    throw new Error(
      `sync:pipeline: failed to substitute ${label} in turbo YAML`,
    );
  }
  return out;
}

/** @deprecated use injectPlaceholder */
function injectSecretPlaceholder(turbo, placeholder, secret, label) {
  return injectPlaceholder(turbo, placeholder, secret, label);
}

function requireEnvValue(turbo, placeholder, envKey) {
  if (!turbo.includes(placeholder)) return null;
  const value = process.env[envKey]?.trim();
  if (!value) {
    throw new Error(
      `sync:pipeline: set ${envKey} in .env for turbo apply (or use GOLDSKY_SYNC_FILES_ONLY=1).`,
    );
  }
  return value;
}

/** @deprecated use requireEnvValue */
function requireEnvSecret(turbo, placeholder, envKey) {
  return requireEnvValue(turbo, placeholder, envKey);
}

/**
 * Resolve ABI + address placeholders (and optional webhook secret) into an applied turbo YAML.
 * @param {'list' | 'single'} [addressMode='list'] — `list` fills `__SYNC_PIPELINE_ADDRESSES__`
 *   (IN (...)); `single` fills `__SYNC_PIPELINE_ROULETTE_ADDRESS__` (equality).
 * @param {string | null} [abiLiteral] — if set, replaces `__SYNC_PIPELINE_ABI__`; if null,
 *   the template must already contain its ABI (CRE countdown uses an inline single-event ABI).
 * @param {string | null} [secretPlaceholder] — if set, substitutes from `secretEnvKey` when present.
 * @param {string | null} [urlPlaceholder] — if set, substitutes from `urlEnvKey` when present.
 * @returns {{ content: string, appliedPath: string, missingSecret: boolean, missingUrl: boolean }}
 */
function writeTurboApplied({
  templateName,
  appliedName,
  abiLiteral = null,
  addressList,
  addressMode = "list",
  secretPlaceholder = null,
  secretEnvKey = null,
  secretLabel = null,
  urlPlaceholder = null,
  urlEnvKey = null,
  urlLabel = null,
}) {
  const templatePath = join(root, templateName);
  const appliedPath = join(root, appliedName);
  if (!existsSync(templatePath)) {
    throw new Error(`sync:pipeline: missing ${templateName}`);
  }

  let turbo = readFileSync(templatePath, "utf8");

  if (abiLiteral !== null) {
    if (!turbo.includes(abiPlaceholder)) {
      throw new Error(
        `sync:pipeline: ${templateName} must contain ${abiPlaceholder}`,
      );
    }
    turbo = turbo.replace(abiPlaceholder, abiLiteral);
  } else if (turbo.includes(abiPlaceholder)) {
    throw new Error(
      `sync:pipeline: ${templateName} still contains ${abiPlaceholder} but no abiLiteral was provided`,
    );
  }

  if (addressMode === "single") {
    if (!turbo.includes(rouletteAddressPlaceholder)) {
      throw new Error(
        `sync:pipeline: ${templateName} must contain ${rouletteAddressPlaceholder}`,
      );
    }
    if (addressList.length !== 1) {
      throw new Error(
        `sync:pipeline: ${templateName} addressMode=single expects exactly 1 address`,
      );
    }
    turbo = turbo.replaceAll(rouletteAddressPlaceholder, addressList[0]);
  } else {
    if (!turbo.includes(addressPlaceholder)) {
      throw new Error(
        `sync:pipeline: ${templateName} must contain ${addressPlaceholder}`,
      );
    }
    turbo = turbo.replace(
      addressPlaceholder,
      addressList.map((x) => `        '${x}'`).join(",\n"),
    );
  }

  let missingSecret = false;
  if (secretPlaceholder && secretEnvKey && secretLabel) {
    const envSecret = process.env[secretEnvKey]?.trim();
    if (turbo.includes(secretPlaceholder) && envSecret) {
      turbo = injectPlaceholder(
        turbo,
        secretPlaceholder,
        envSecret,
        secretLabel,
      );
      console.log(`Injected ${secretLabel} into ${appliedName}`);
    } else if (turbo.includes(secretPlaceholder)) {
      missingSecret = true;
      console.warn(
        `sync:pipeline: ${appliedName} still contains ${secretPlaceholder}; set ${secretEnvKey} in .env before goldsky turbo apply.`,
      );
    }
  }

  let missingUrl = false;
  if (urlPlaceholder && urlEnvKey && urlLabel) {
    const envUrl = process.env[urlEnvKey]?.trim();
    if (turbo.includes(urlPlaceholder) && envUrl) {
      turbo = injectPlaceholder(turbo, urlPlaceholder, envUrl, urlLabel);
      console.log(`Injected ${urlLabel} into ${appliedName}`);
    } else if (turbo.includes(urlPlaceholder)) {
      missingUrl = true;
      console.warn(
        `sync:pipeline: ${appliedName} still contains ${urlPlaceholder}; set ${urlEnvKey} in .env before goldsky turbo apply.`,
      );
    }
  }

  writeFileSync(appliedPath, turbo, "utf8");
  console.log(
    `Wrote ${appliedName} (resolved ABI + addresses; ${templateName} unchanged)`,
  );
  return { content: turbo, appliedPath, missingSecret, missingUrl };
}

function validateAndApplyTurbo(pipelineFile) {
  try {
    execSync(`yarn goldsky turbo validate ${pipelineFile}`, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    console.warn(`turbo validate failed for ${pipelineFile}; continuing to apply.`);
  }

  execSync(`yarn goldsky turbo apply ${pipelineFile}`, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function cleanupAppliedTurbo(appliedName) {
  const appliedTurbo = join(root, appliedName);
  if (!existsSync(appliedTurbo)) return;
  try {
    unlinkSync(appliedTurbo);
  } catch {
    /* ignore */
  }
}

const DEPLOY_JSON = process.env.DEPLOY_JSON;
if (!DEPLOY_JSON) {
  console.error("sync:pipeline: set DEPLOY_JSON to the deployment JSON path.");
  process.exit(1);
}

const deployPath = resolve(root, DEPLOY_JSON);
const deploy = JSON.parse(readFileSync(deployPath, "utf8"));

function blockFor(key) {
  const v = deploy.startBlocks?.[key];
  const raw = v !== undefined && v !== null ? v : deploy.startBlock;
  if (raw === undefined || raw === null) {
    throw new Error(
      `sync:pipeline: missing startBlock (set startBlock and/or startBlocks.${key})`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`sync:pipeline: invalid start block for ${key}`);
  }
  return n;
}

const a = deploy.addresses;
function addr(key) {
  const v = a?.[key];
  if (!v || typeof v !== "string") {
    throw new Error(`sync:pipeline: missing addresses.${key}`);
  }
  return v.toLowerCase();
}

function collectBankAddresses() {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const x = String(raw).toLowerCase();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  if (Array.isArray(a.banks)) {
    for (const bank of a.banks) add(bank);
  }
  if (a.markets && typeof a.markets === "object") {
    for (const m of Object.values(a.markets)) {
      if (m && typeof m === "object" && m.bank) add(m.bank);
    }
  }
  return out;
}

const bankAddresses = collectBankAddresses();
const turboAddresses = [addr("brb"), addr("roulette"), addr("brbReferal"), ...bankAddresses];
if (a.upkeepManager) turboAddresses.push(addr("upkeepManager"));
if (a.sideBet) turboAddresses.push(addr("sideBet"));
if (a.jackpotFunder) turboAddresses.push(addr("jackpotFunder"));
if (bankAddresses.length > 0) {
  console.log(`Turbo vault addresses: ${bankAddresses.length} bank(s)`);
}

/** SideBet.sol events indexed by subgraph + turbo webhook mirror. */
const SIDEBET_TURBO_EVENTS = new Set([
  "ConfigAdded",
  "ConfigUpdated",
  "ConfigStakeLimitsUpdated",
  "ConfigRemoved",
  "SideBetPlaced",
  "SideBetSettled",
  "SideBetInfrastructureFeePaid",
  "SideBetJackpotFunded",
]);

/** BRBJackpotFunder events for subgraph handlers + useful mirror observability. */
const JACKPOT_FUNDER_TURBO_EVENTS = new Set([
  "FundedFromMarket",
  "FundFromMarketSkipped",
  "SwapAssetBpsUpdated",
  "TreasuryBrbSplitUpdated",
  "SlippageBpsUpdated",
  "BrbRatioUpdated",
  "JackpotBurnFailed",
  "JackpotTreasuryTransferFailed",
]);

function normalizeEventInput(input) {
  const next = { ...input };
  const typeEnum =
    typeof next.type === "string" && next.type.startsWith("enum ");
  const internalEnum =
    typeof next.internalType === "string" && next.internalType.startsWith("enum ");
  if (typeEnum || internalEnum) {
    next.type = "uint8";
    next.internalType = "uint8";
  }
  return next;
}

function normalizeEventInputsInAbi(abiArray) {
  return abiArray.map((fragment) => {
    if (fragment.type !== "event") return fragment;
    const needsNorm = fragment.inputs?.some(
      (input) =>
        (typeof input.type === "string" && input.type.startsWith("enum ")) ||
        (typeof input.internalType === "string" &&
          input.internalType.startsWith("enum ")),
    );
    return needsNorm ? normalizeEventFragment(fragment) : fragment;
  });
}

function normalizeEventFragment(event) {
  return {
    ...event,
    inputs: event.inputs.map(normalizeEventInput),
  };
}

function mergeContractEventsFromAbi(abiArray, abiFile, trackedEvents, label) {
  const abiPath = join(root, "abis", abiFile);
  if (!existsSync(abiPath)) return abiArray;

  let raw = readFileSync(abiPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const parsed = JSON.parse(raw);
  const contractAbi = Array.isArray(parsed) ? parsed : parsed.abi;
  if (!Array.isArray(contractAbi)) return abiArray;

  const existing = new Set(
    abiArray.filter((f) => f.type === "event").map((f) => f.name),
  );
  const merged = [...abiArray];
  let added = 0;
  for (const fragment of contractAbi) {
    if (fragment.type !== "event" || !trackedEvents.has(fragment.name)) continue;
    if (existing.has(fragment.name)) continue;
    merged.push(normalizeEventFragment(fragment));
    existing.add(fragment.name);
    added++;
  }
  if (added > 0) {
    console.log(`Merged ${added} ${label} event(s) into pipeline ABI`);
  }
  return merged;
}

function mergeSideBetContractEvents(abiArray) {
  return mergeContractEventsFromAbi(abiArray, "SideBet.json", SIDEBET_TURBO_EVENTS, "SideBet");
}

function mergeJackpotFunderContractEvents(abiArray) {
  return mergeContractEventsFromAbi(
    abiArray,
    "BRBJackpotFunder.json",
    JACKPOT_FUNDER_TURBO_EVENTS,
    "BRBJackpotFunder",
  );
}

const mergedAbiPath = join(root, "abis", "MergedEvents.json");
if (!existsSync(mergedAbiPath)) {
  console.error(
    `sync:pipeline: ${mergedAbiPath} not found. Run from contracts repo: yarn update:subgraph:abis`,
  );
  process.exit(1);
}

let mergedRaw = readFileSync(mergedAbiPath, "utf8");
if (mergedRaw.charCodeAt(0) === 0xfeff) mergedRaw = mergedRaw.slice(1);
let abiArray;
try {
  const parsed = JSON.parse(mergedRaw);
  if (Array.isArray(parsed)) abiArray = parsed;
  else if (parsed && Array.isArray(parsed.abi)) abiArray = parsed.abi;
  else throw new Error("expected array or { abi: [] }");
} catch (e) {
  throw new Error(`sync:pipeline: ${mergedAbiPath}: ${e.message}`);
}

const abiBeforeMerge = JSON.stringify(abiArray);
abiArray = normalizeEventInputsInAbi(
  mergeJackpotFunderContractEvents(mergeSideBetContractEvents(abiArray)),
);
if (JSON.stringify(abiArray) !== abiBeforeMerge) {
  writeFileSync(mergedAbiPath, `${JSON.stringify(abiArray, null, 2)}\n`, "utf8");
  console.log(`Wrote ${mergedAbiPath} (SideBet + BRBJackpotFunder events)`);
}

const minifiedAbi = JSON.stringify(abiArray);
const sqlAbiLiteral = minifiedAbi.replace(/\\/g, "\\\\").replace(/'/g, "''");
console.log(
  `Merged ABI: ${abiArray.length} event fragment(s), ${minifiedAbi.length} chars (minified)`,
);

const mirrorTurbo = writeTurboApplied({
  templateName: "turbo.yaml",
  appliedName: "turbo.applied.yaml",
  abiLiteral: sqlAbiLiteral,
  addressList: turboAddresses,
  secretPlaceholder: WEBHOOK_SECRET_PLACEHOLDER,
  secretEnvKey: "WEBHOOK_SECRET",
  secretLabel: "WEBHOOK_SECRET",
});

const creTurbo = writeTurboApplied({
  templateName: "turbo-cre.yaml",
  appliedName: "turbo-cre.applied.yaml",
  // ABI is inlined; auth is Goldsky secret_name (BIRIBI_CRE_SCHEDULE), not a URL query.
  abiLiteral: null,
  addressList: [addr("roulette")],
  addressMode: "single",
  urlPlaceholder: CRE_WEBHOOK_URL_PLACEHOLDER,
  urlEnvKey: "CRE_WEBHOOK_URL",
  urlLabel: "CRE_WEBHOOK_URL",
});

let turbo = mirrorTurbo.content;
const turboAppliedPath = mirrorTurbo.appliedPath;

let subgraph = readFileSync(join(root, "subgraph.yaml"), "utf8");

const dsMap = [
  ["BRBToken", "brb"],
  ["RouletteEngine", "roulette"],
  ["BRBReferral", "brbReferal"],
  ["BRBJackpotFunder", "jackpotFunder"],
  ["SideBet", "sideBet"],
  ["AutomationReceiver", "automationReceiver"],
  ["UpkeepScheduler", "scheduler"],
  ["CreExecutionAuthority", "creExecutionAuthority"],
];
for (const [name, key] of dsMap) {
  const addrRe = new RegExp(
    `(name: ${name}\\n    kind: ethereum/contract\\n    network: [^\\n]+\\n    source:\\n      abi: [^\\n]+\\n      address: )(\"0x[a-fA-F0-9]+\")(\\s*#.*)?`,
    "m",
  );
  subgraph = subgraph.replace(addrRe, (_, prefix, _quoted, comment) => {
    return `${prefix}"${addr(key)}"${comment ?? ""}`;
  });
  const sb = blockFor(key);
  const sbRe = new RegExp(
    `(name: ${name}\\n    kind: ethereum/contract\\n    network: [^\\n]+\\n    source:\\n      abi: [^\\n]+\\n      address: \"[^\"]+\"(?:\\s*#.*)?\\n      startBlock: )\\d+(\\s*#.*)?`,
    "m",
  );
  subgraph = subgraph.replace(sbRe, (_, prefix, comment) => `${prefix}${sb}${comment ?? ""}`);
}
writeFileSync(join(root, "subgraph.yaml"), subgraph, "utf8");
console.log("Patched subgraph.yaml addresses and start blocks");

// src/helpers/constant.ts hardcodes two addresses the mappings compare against
// (jackpot-payout detection + BRB market classification). Patch them from the
// deployment JSON so a redeploy can never leave them stale.
const constantPath = join(root, "src", "helpers", "constant.ts");
let constantTs = readFileSync(constantPath, "utf8");
const constantMap = [
  ["JACKPOT_TREASURY_ADDRESS", addr("jackpotTreasury")],
  ["BRB_TOKEN_ADDRESS", addr("brb")],
];
for (const [name, value] of constantMap) {
  const constRe = new RegExp(
    `(export const ${name} = Address\\.fromString\\(\\s*")0x[a-fA-F0-9]{40}("\\s*\\))`,
  );
  if (!constRe.test(constantTs)) {
    throw new Error(
      `sync:pipeline: cannot find ${name} in src/helpers/constant.ts`,
    );
  }
  constantTs = constantTs.replace(constRe, `$1${value}$2`);
}
writeFileSync(constantPath, constantTs, "utf8");
console.log("Patched src/helpers/constant.ts addresses");

if (process.env.GOLDSKY_SYNC_FILES_ONLY === "1") {
  console.log("GOLDSKY_SYNC_FILES_ONLY=1 — skipping Goldsky CLI, codegen, deploy.");
  process.exit(0);
}

const baseName = process.env.GOLDSKY_SUBGRAPH_NAME ?? "biribi";

function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function execSyncMerged(cmd) {
  return execSync(`${cmd} 2>&1`, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    shell: true,
  });
}

function parseAllDeployedVersions(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}/(\\d+\\.\\d+\\.\\d+)`, "g");
  const out = [];
  let m;
  while ((m = re.exec(output)) !== null) {
    if (semver.valid(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

function parseProdTargetVersion(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${escaped}/prod\\s*->\\s*${escaped}/(\\d+\\.\\d+\\.\\d+)`,
    "m",
  );
  const m = output.match(re);
  if (m && semver.valid(m[1])) return m[1];
  return null;
}

function fetchGoldskySubgraphList() {
  const cmds = [
    `yarn goldsky subgraph list`,
    `yarn goldsky subgraph list ${baseName}`,
    `yarn goldsky subgraph list ${baseName} --summary`,
  ];
  for (const cmd of cmds) {
    try {
      const text = stripAnsi(String(execSyncMerged(cmd)));
      const versions = parseAllDeployedVersions(text, baseName);
      if (versions.length > 0) {
        console.log(`(Goldsky list: ${versions.length} semver via: ${cmd})`);
        return text;
      }
    } catch (e) {
      const err = e;
      if (err && typeof err === "object" && "stdout" in err) {
        const text = stripAnsi(String(err.stdout ?? "") + String(err.stderr ?? ""));
        if (parseAllDeployedVersions(text, baseName).length > 0) return text;
      }
    }
  }
  return "";
}

function pruneOldestSubgraphIfNeeded(deployed, maxVer, listOutput) {
  if (process.env.GOLDSKY_SUBGRAPH_AUTO_PRUNE === "0") {
    console.log("GOLDSKY_SUBGRAPH_AUTO_PRUNE=0 — skip prune.");
    return;
  }
  if (!deployed.length || !maxVer || deployed.length < 2) return;
  const sorted = [...deployed].sort(semver.compare);
  const minV = sorted[0];
  if (!semver.lt(minV, maxVer)) return;

  const prodTarget = parseProdTargetVersion(listOutput, baseName);
  if (prodTarget && semver.eq(minV, prodTarget)) {
    if (process.env.GOLDSKY_SKIP_PROD_REPOINT_FOR_PRUNE === "1") {
      console.warn(
        `Oldest ${baseName}/${minV} is prod; move prod before prune or unset GOLDSKY_SKIP_PROD_REPOINT_FOR_PRUNE.`,
      );
      return;
    }
    const prodFull = `${baseName}/${maxVer}`;
    console.log(`Moving prod → ${prodFull} before deleting ${minV}…`);
    execSync(`yarn goldsky subgraph tag create ${prodFull} --tag prod`, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  }

  execSync(`yarn goldsky subgraph delete ${baseName}/${minV} --force`, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function computeNextSubgraphVersion(output, name, pkgVersion) {
  const deployed = parseAllDeployedVersions(output, name);
  const maxDeployed =
    deployed.length > 0 ? deployed.reduce((a, b) => (semver.gt(a, b) ? a : b)) : null;
  const pkgBase = semver.valid(pkgVersion) ? pkgVersion : "0.0.0";
  const fromPkg = semver.inc(pkgBase, "patch");
  const candidates = [];
  if (maxDeployed) {
    const inc = semver.inc(maxDeployed, "patch");
    if (inc) candidates.push(inc);
  }
  if (fromPkg) candidates.push(fromPkg);
  if (candidates.length === 0) return "0.0.1";
  return candidates.reduce((a, b) => (semver.gt(a, b) ? a : b));
}

const pkgPath = join(root, "package.json");
const pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
const pkgVersionPre = pkgJson.version ?? "0.0.0";

const listOutput = fetchGoldskySubgraphList();
const deployedVersions = parseAllDeployedVersions(listOutput, baseName);
const maxDeployedVer = deployedVersions.length
  ? deployedVersions.reduce((a, b) => (semver.gt(a, b) ? a : b))
  : null;
pruneOldestSubgraphIfNeeded(deployedVersions, maxDeployedVer, listOutput);

const nextVersion = computeNextSubgraphVersion(listOutput, baseName, pkgVersionPre);
console.log("Next subgraph version:", nextVersion);

pkgJson.version = nextVersion;
writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, "utf8");

const schemaPath = join(root, "schema.graphql");
const schemaOriginal = readFileSync(schemaPath, "utf8");

function bumpSchemaGraphqlBuildMarker(content) {
  const stripped = content.replace(/\n# sync-pipeline-build-id:.*$/m, "");
  return `${stripped.trimEnd()}\n\n# sync-pipeline-build-id: ${Date.now()}\n`;
}

try {
  writeFileSync(schemaPath, bumpSchemaGraphqlBuildMarker(schemaOriginal));

  execSync("yarn codegen", { cwd: root, stdio: "inherit" });
  execSync("yarn build", { cwd: root, stdio: "inherit" });

  const turboPipelines = [
    {
      file: "turbo.applied.yaml",
      content: turbo,
      placeholder: WEBHOOK_SECRET_PLACEHOLDER,
      envKey: "WEBHOOK_SECRET",
      label: "WEBHOOK_SECRET",
      appliedPath: turboAppliedPath,
    },
    {
      file: "turbo-cre.applied.yaml",
      content: creTurbo.content,
      // Auth via Goldsky secret_name (BIRIBI_CRE_SCHEDULE); URL from CRE_WEBHOOK_URL.
      placeholder: null,
      urlPlaceholder: CRE_WEBHOOK_URL_PLACEHOLDER,
      urlEnvKey: "CRE_WEBHOOK_URL",
      urlLabel: "CRE_WEBHOOK_URL",
      appliedPath: creTurbo.appliedPath,
    },
  ];

  for (const pipeline of turboPipelines) {
    let content = pipeline.content;
    if (
      pipeline.placeholder &&
      content.includes(pipeline.placeholder)
    ) {
      const secret = requireEnvValue(
        content,
        pipeline.placeholder,
        pipeline.envKey,
      );
      content = injectPlaceholder(
        content,
        pipeline.placeholder,
        secret,
        pipeline.label,
      );
      writeFileSync(pipeline.appliedPath, content, "utf8");
      console.log(
        `Wrote ${pipeline.file} with ${pipeline.label} for Goldsky.`,
      );
    }
    if (
      pipeline.urlPlaceholder &&
      content.includes(pipeline.urlPlaceholder)
    ) {
      const url = requireEnvValue(
        content,
        pipeline.urlPlaceholder,
        pipeline.urlEnvKey,
      );
      content = injectPlaceholder(
        content,
        pipeline.urlPlaceholder,
        url,
        pipeline.urlLabel,
      );
      writeFileSync(pipeline.appliedPath, content, "utf8");
      console.log(
        `Wrote ${pipeline.file} with ${pipeline.urlLabel} for Goldsky.`,
      );
    }
    validateAndApplyTurbo(pipeline.file);
  }

  const fullName = `${baseName}/${nextVersion}`;
  execSync(
    `yarn goldsky subgraph deploy ${fullName} --path . --description ${JSON.stringify(`sync-pipeline ${new Date().toISOString()}`)}`,
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (process.env.GOLDSKY_SKIP_PROD_TAG === "1") {
    console.log("GOLDSKY_SKIP_PROD_TAG=1 — prod tag unchanged.");
  } else {
    execSync(`yarn goldsky subgraph tag create ${fullName} --tag prod`, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    console.log(`Tagged prod -> ${fullName}`);
  }
} finally {
  writeFileSync(schemaPath, schemaOriginal, "utf8");
  cleanupAppliedTurbo("turbo.applied.yaml");
  cleanupAppliedTurbo("turbo-cre.applied.yaml");
}
