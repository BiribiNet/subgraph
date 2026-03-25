/**
 * Patch turbo.yaml (Goldsky _gs_log_decode ABI + contract addresses) and subgraph.yaml
 * from a deployment JSON, then optionally validate/apply turbo + deploy subgraph (tcg-vault style).
 *
 * Prerequisites: from ../contracts run `yarn update:subgraph:abis` (generates abis/MergedEvents.json).
 *
 * Usage:
 *   DEPLOY_JSON=./deployments/arbitrum-sepolia.json yarn sync:pipeline
 *
 * Env:
 *   DEPLOY_JSON              — path to JSON (required) see deployments/example-arbitrum-sepolia.json
 *                            — optional startBlocks.{brb,roulette,stakedBRB,brbReferal} override startBlock per data source
 *                            — optional addresses.upkeepManager appends BRBUpkeepManager to turbo `WHERE address IN` (CleaningUpkeepRegistered, etc.)
 *   GOLDSKY_SUBGRAPH_NAME    — default biribi
 *   GOLDSKY_SYNC_FILES_ONLY  — if 1, only patch YAML files (no goldsky CLI)
 *   WEBHOOK_SECRET           — required for full sync if turbo.yaml url contains ${WEBHOOK_SECRET}
 */
import { config } from "dotenv";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

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

const turboAddresses = [addr("brb"), addr("roulette"), addr("stakedBRB"), addr("brbReferal")];
if (a.upkeepManager) {
  turboAddresses.push(addr("upkeepManager"));
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

const minifiedAbi = JSON.stringify(abiArray);
const sqlAbiLiteral = minifiedAbi.replace(/\\/g, "\\\\").replace(/'/g, "''");
console.log(
  `Merged ABI: ${abiArray.length} event fragment(s), ${minifiedAbi.length} chars (minified)`,
);

function injectMergedAbiIntoTurbo(turboContent, escapedAbi) {
  if (/_gs_fetch_abi\s*\(/.test(turboContent)) {
    return turboContent.replace(
      /_gs_fetch_abi\('((?:[^']|'')*)',\s*'raw'\)/,
      `'${escapedAbi}'`,
    );
  }
  return turboContent.replace(
    /(_gs_log_decode\(\s*[\r\n]+\s*)'([\s\S]*?)',\s*[\r\n]+\s*topics/,
    `$1'${escapedAbi}',\n          topics`,
  );
}

let turbo = readFileSync(join(root, "turbo.yaml"), "utf8");
const hasFetchAbiCall = /_gs_fetch_abi\s*\(/.test(turbo);
const hasInlineDecodeAbi =
  /_gs_log_decode\(\s*[\r\n]+\s*'[\s\S]*?',\s*[\r\n]+\s*topics/.test(turbo);
const turboAfterAbi = injectMergedAbiIntoTurbo(turbo, sqlAbiLiteral);
if (turboAfterAbi === turbo && !hasFetchAbiCall && !hasInlineDecodeAbi) {
  throw new Error(
    "sync:pipeline: turbo.yaml: expected _gs_fetch_abi('…','raw') or _gs_log_decode('…', … topics — fix decoded_events SQL.",
  );
}
turbo = turboAfterAbi;

const inList = turboAddresses.map((x) => `        '${x}'`).join(",\n");
turbo = turbo.replace(
  /FROM raw_logs\s*\n\s*WHERE address IN\s*\([\s\S]*?\)/,
  `FROM raw_logs\n      WHERE address IN (\n${inList}\n      )`,
);
writeFileSync(join(root, "turbo.yaml"), turbo, "utf8");
console.log("Wrote turbo.yaml");

let subgraph = readFileSync(join(root, "subgraph.yaml"), "utf8");
const dsMap = [
  ["BRBToken", "brb"],
  ["RouletteClean", "roulette"],
  ["StakedBRB", "stakedBRB"],
  ["BRBReferal", "brbReferal"],
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

  let turboPipelineFile = "turbo.yaml";
  if (turbo.includes("${WEBHOOK_SECRET}")) {
    const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      throw new Error(
        "sync:pipeline: set WEBHOOK_SECRET in .env for turbo apply (or use GOLDSKY_SYNC_FILES_ONLY=1).",
      );
    }
    const appliedPath = join(root, "turbo.applied.yaml");
    const yamlDoubleQuotedSecret =
      /\$\{WEBHOOK_SECRET\}"/.test(turbo) || /\?secret=\$\{WEBHOOK_SECRET\}"/.test(turbo);
    const turboWithSecret = yamlDoubleQuotedSecret
      ? turbo.replace(
          /\$\{WEBHOOK_SECRET\}/g,
          webhookSecret.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
        )
      : turbo.replace(/\$\{WEBHOOK_SECRET\}/g, webhookSecret);
    writeFileSync(appliedPath, turboWithSecret, "utf8");
    turboPipelineFile = "turbo.applied.yaml";
    console.log("Wrote turbo.applied.yaml with webhook secret for Goldsky.");
  }

  try {
    execSync(`yarn goldsky turbo validate ${turboPipelineFile}`, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    console.warn("turbo validate failed; continuing to apply.");
  }

  execSync(`yarn goldsky turbo apply ${turboPipelineFile}`, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

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
  const appliedTurbo = join(root, "turbo.applied.yaml");
  if (existsSync(appliedTurbo)) {
    try {
      unlinkSync(appliedTurbo);
    } catch {
      /* ignore */
    }
  }
}
