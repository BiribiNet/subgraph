#!/usr/bin/env node
/**
 * Deploy subgraph to Goldsky via REST API (bypasses CLI proxy/TTY issues).
 *
 * Usage:
 *   node scripts/goldsky-deploy.mjs <name>/<version> [--description "..."] [--tag prod]
 *
 * Requires:
 *   - ~/.goldsky/auth_token (written by `goldsky login`)
 *   - A successful `graph build` (build/ directory must exist)
 *
 * Environment:
 *   GOLDSKY_API_BASE  — override API base (default: https://api.goldsky.com)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let nameAndVersion = null;
let description = "";
let tags = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--description" && args[i + 1]) {
    description = args[++i];
  } else if (args[i] === "--tag" && args[i + 1]) {
    tags.push(args[++i]);
  } else if (!args[i].startsWith("-")) {
    nameAndVersion = args[i];
  }
}

if (!nameAndVersion || !nameAndVersion.includes("/")) {
  console.error("Usage: goldsky-deploy.mjs <name>/<version> [--description '...'] [--tag prod]");
  process.exit(1);
}

const [name, version] = nameAndVersion.split("/", 2);

// ── Auth token ────────────────────────────────────────────────────────────────
const tokenPath = join(homedir(), ".goldsky", "auth_token");
if (!existsSync(tokenPath)) {
  console.error(`Auth token not found at ${tokenPath}. Run: echo -n '<token>' > ~/.goldsky/auth_token`);
  process.exit(1);
}
const token = readFileSync(tokenPath, "utf8").trim();
const apiBase = process.env.GOLDSKY_API_BASE ?? "https://api.goldsky.com";

// ── Build directory ───────────────────────────────────────────────────────────
const buildDir = join(root, "build");
if (!existsSync(join(buildDir, "subgraph.yaml"))) {
  console.error("build/subgraph.yaml not found. Run `yarn codegen && yarn build` first.");
  process.exit(1);
}

// ── Create bundle zip ─────────────────────────────────────────────────────────
// Goldsky expects a zip containing: subgraph.yaml, schema.graphql, wasm files, abi files
// We use the system `zip` command to create it from the build/ directory.

const bundlePath = join(root, ".goldsky-bundle.zip");

console.log(`Packaging build/ into bundle...`);

// Collect all files in build/
function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, base));
    } else {
      files.push(relative(base, full));
    }
  }
  return files;
}

const buildFiles = collectFiles(buildDir);
console.log(`  ${buildFiles.length} files in bundle`);

try {
  execSync(`rm -f "${bundlePath}" && cd "${buildDir}" && zip -q -r "${bundlePath}" .`, {
    stdio: "inherit",
  });
} catch {
  console.error("Failed to create bundle zip. Is `zip` installed?");
  process.exit(1);
}

// ── Deploy via API ────────────────────────────────────────────────────────────
const deployUrl = `${apiBase}/api/admin/subgraph/v1/subgraphs/${name}/deployments/${version}`;
console.log(`\nDeploying ${name}/${version} to Goldsky...`);
console.log(`  PUT ${deployUrl}`);

const curlArgs = [
  "curl", "-s", "-w", "\\n%{http_code}",
  "-X", "PUT",
  "-H", `Authorization: Bearer ${token}`,
  "-F", `bundle=@${bundlePath};filename=bundle.zip;type=application/octet-stream`,
  "-F", "overwrite=0",
  "-F", "remove_graft=0",
  "-F", "skip_graft_validation=0",
];

if (description) {
  curlArgs.push("-F", `description=${description}`);
}

curlArgs.push(deployUrl);

let deployOutput;
try {
  deployOutput = execSync(curlArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" "), {
    encoding: "utf8",
    timeout: 120_000,
  });
} catch (e) {
  console.error("Deploy request failed:", e.message);
  process.exit(1);
} finally {
  // Clean up bundle
  try { execSync(`rm -f "${bundlePath}"`, { stdio: "ignore" }); } catch { /* ignore */ }
}

const lines = deployOutput.trim().split("\n");
const httpStatus = lines.pop();
const body = lines.join("\n");

let parsed;
try { parsed = JSON.parse(body); } catch { parsed = null; }

if (httpStatus === "200" || httpStatus === "201") {
  console.log(`\n  Deployed ${name}/${version} successfully!`);
  if (parsed?.data) {
    const d = parsed.data;
    console.log(`  Health: ${d.health ?? "pending"}`);
    console.log(`  Endpoint: ${apiBase}${d.graphql_endpoint ?? ""}`);
  }
} else if (httpStatus === "524") {
  console.log(`\n  Deployment is taking longer than usual but will continue in the background.`);
  console.log(`  Check status at: https://app.goldsky.com/dashboard`);
} else {
  console.error(`\n  Deploy failed (HTTP ${httpStatus}):`);
  console.error(`  ${body}`);
  process.exit(1);
}

// ── Tag ───────────────────────────────────────────────────────────────────────
for (const tag of tags) {
  console.log(`\nTagging ${name}/${version} as "${tag}"...`);
  const tagUrl = `${apiBase}/api/admin/subgraph/v1/subgraphs/${name}/tags/${tag}`;

  let tagOutput;
  try {
    tagOutput = execSync(
      `curl -s -w '\\n%{http_code}' -X PUT -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"target_version":"${version}"}' '${tagUrl}'`,
      { encoding: "utf8", timeout: 30_000 },
    );
  } catch (e) {
    console.error(`  Tag "${tag}" failed:`, e.message);
    continue;
  }

  const tagLines = tagOutput.trim().split("\n");
  const tagStatus = tagLines.pop();
  if (tagStatus === "200" || tagStatus === "201") {
    console.log(`  Tagged ${name}/${tag} → ${version}`);
  } else {
    console.error(`  Tag failed (HTTP ${tagStatus}): ${tagLines.join("\n")}`);
  }
}

console.log("\nDone.");
