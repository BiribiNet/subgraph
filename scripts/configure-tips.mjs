import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Generate a deployable manifest only from an actual confirmed deployment record.
const metadataPath = process.argv[2];
if (!metadataPath) throw new Error("Usage: node scripts/configure-tips.mjs <tip-jar-deployment.json>");
const metadata = JSON.parse(readFileSync(resolve(metadataPath), "utf8"));
const address = /^0x[0-9a-fA-F]{40}$/;
const nonzero = value => address.test(value ?? "") && !/^0x0{40}$/i.test(value);
if (![metadata.address, metadata.token, metadata.recipient, metadata.engine].every(nonzero)
  || !Number.isSafeInteger(metadata.startBlock) || metadata.startBlock <= 0
  || !/^0x[0-9a-fA-F]{64}$/.test(metadata.transactionHash ?? "")) throw new Error("Invalid deployment metadata");
const network = { 42161: "arbitrum-one", 421614: "arbitrum-sepolia" }[metadata.chainId];
const manifest = readFileSync("subgraph.yaml", "utf8").replace(/\r\n/g, "\n");
const networks = [...manifest.matchAll(/^\s+network:\s*(\S+)/gm)].map(match => match[1]);
if (!network || !networks.length || networks.some(value => value !== network)) throw new Error("Deployment/manifest network mismatch");
for (const expected of [metadata.token, metadata.engine]) {
  if (!manifest.toLowerCase().includes(expected.toLowerCase())) throw new Error("Deployment token/engine differs from manifest");
}
const template = manifest.slice(manifest.indexOf("  - name: TipJar\n"));
if (!template.startsWith("  - name: TipJar\n")) throw new Error("TipJar template missing");
const source = template.replace("    source:\n      abi: TipJar", `    source:\n      address: '${metadata.address}'\n      startBlock: ${metadata.startBlock}\n      abi: TipJar`);
writeFileSync("subgraph.tips.yaml", manifest.replace("templates:\n", `${source}\ntemplates:\n`));
console.log("Created subgraph.tips.yaml. Verify deployment metadata against its receipt before deploying.");
