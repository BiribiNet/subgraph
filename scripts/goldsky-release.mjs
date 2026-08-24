#!/usr/bin/env node
/**
 * Full Goldsky release: codegen + build, deploy the next version, move the
 * `prod` tag, then delete superseded versions. Designed for CI (GitHub
 * Actions) where `GOLDSKY_API_TOKEN` is a repository secret — the deploy + tag
 * go through the REST helper (`scripts/goldsky-deploy.mjs`), list + delete go
 * through the Goldsky CLI (fine outside proxied sandboxes).
 *
 * Usage:
 *   GOLDSKY_API_TOKEN=... node scripts/goldsky-release.mjs
 *
 * Environment:
 *   GOLDSKY_API_TOKEN     — Goldsky API token (required; GOLDSKY_TOKEN also read)
 *   GOLDSKY_SUBGRAPH_NAME — subgraph name (default: biribi)
 *   VERSION               — explicit version to deploy (default: auto — one
 *                           patch above max(deployed versions, package.json))
 *   PRUNE                 — set to 0 to keep superseded versions (default: prune)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const subgraphName = process.env.GOLDSKY_SUBGRAPH_NAME ?? "biribi";

const token = (process.env.GOLDSKY_API_TOKEN ?? process.env.GOLDSKY_TOKEN ?? "").trim();
if (!token) {
  console.error(
    "goldsky-release: GOLDSKY_API_TOKEN is not set. In GitHub Actions, expose the " +
    "repository secret as an env var on the release step.",
  );
  process.exit(1);
}

// The CLI reads its auth from ~/.goldsky/auth_token (see DEPLOY.md).
const goldskyDir = join(homedir(), ".goldsky");
if (!existsSync(goldskyDir)) mkdirSync(goldskyDir, { recursive: true });
writeFileSync(join(goldskyDir, "auth_token"), token, { mode: 0o600 });

function run(command, options = {}) {
  return execSync(command, { cwd: root, encoding: "utf8", stdio: "pipe", ...options });
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function listDeployedVersions() {
  let output = "";
  try {
    output = stripAnsi(run(`yarn goldsky subgraph list ${subgraphName} 2>&1`));
  } catch (error) {
    output = stripAnsi(String(error.stdout ?? "") + String(error.stderr ?? ""));
  }
  const escapedName = subgraphName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionPattern = new RegExp(`${escapedName}/(\\d+\\.\\d+\\.\\d+)`, "g");
  const versions = new Set();
  let match;
  while ((match = versionPattern.exec(output)) !== null) {
    if (semver.valid(match[1])) versions.add(match[1]);
  }
  return [...versions];
}

function computeNextVersion(deployedVersions) {
  const explicit = process.env.VERSION?.trim();
  if (explicit) {
    if (!semver.valid(explicit)) {
      console.error(`goldsky-release: VERSION "${explicit}" is not valid semver.`);
      process.exit(1);
    }
    return explicit;
  }
  const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const candidates = [];
  if (deployedVersions.length > 0) {
    const maxDeployed = deployedVersions.reduce((a, b) => (semver.gt(a, b) ? a : b));
    candidates.push(semver.inc(maxDeployed, "patch"));
  }
  if (semver.valid(packageVersion)) {
    candidates.push(semver.inc(packageVersion, "patch"));
  }
  const next = candidates.filter(Boolean).sort(semver.rcompare)[0];
  return next ?? "0.0.1";
}

const deployedBefore = listDeployedVersions();
console.log(
  deployedBefore.length > 0
    ? `Deployed versions: ${deployedBefore.sort(semver.compare).join(", ")}`
    : "No deployed versions found (or list unavailable) — falling back to package.json.",
);

const nextVersion = computeNextVersion(deployedBefore);
console.log(`Releasing ${subgraphName}/${nextVersion}\n`);

execSync("yarn codegen", { cwd: root, stdio: "inherit" });
execSync("yarn build", { cwd: root, stdio: "inherit" });

const releaseDescription = `goldsky-release ${new Date().toISOString()}`;
execSync(
  `node scripts/goldsky-deploy.mjs ${subgraphName}/${nextVersion} --tag prod --description ${JSON.stringify(releaseDescription)}`,
  { cwd: root, stdio: "inherit", env: { ...process.env, GOLDSKY_API_TOKEN: token } },
);

if (process.env.PRUNE === "0") {
  console.log("\nPRUNE=0 — keeping superseded versions.");
} else {
  const superseded = deployedBefore.filter((deployed) => semver.lt(deployed, nextVersion));
  if (superseded.length === 0) {
    console.log("\nNo superseded versions to delete.");
  }
  for (const oldVersion of superseded.sort(semver.compare)) {
    console.log(`\nDeleting superseded ${subgraphName}/${oldVersion}...`);
    try {
      execSync(`yarn goldsky subgraph delete ${subgraphName}/${oldVersion} --force`, {
        cwd: root,
        stdio: "inherit",
      });
    } catch {
      // Deletion is cleanup, not correctness: the new version is already live
      // and tagged prod, so log and keep going rather than failing the release.
      console.error(`  Could not delete ${subgraphName}/${oldVersion} — remove it from the dashboard.`);
    }
  }
}

console.log(`\nRelease complete: ${subgraphName}/${nextVersion} (tag: prod)`);
