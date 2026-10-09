import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./configure-tips.mjs", import.meta.url));
const token = `0x${"1".repeat(40)}`;
const engine = `0x${"2".repeat(40)}`;
const metadata = { chainId: 421614, address: `0x${"3".repeat(40)}`, token, engine,
  recipient: `0x${"4".repeat(40)}`, startBlock: 12345, transactionHash: `0x${"a".repeat(64)}` };
const manifest = `dataSources:
  - name: BRBToken
    network: arbitrum-sepolia
    source:
      address: '${token}'
  - name: RouletteEngine
    network: arbitrum-sepolia
    source:
      address: '${engine}'
templates:
  - name: TipJar
    kind: ethereum/contract
    network: arbitrum-sepolia
    source:
      abi: TipJar
`;

function run(record, source = manifest) {
  const cwd = mkdtempSync(join(tmpdir(), "biribi-tips-manifest-"));
  writeFileSync(join(cwd, "subgraph.yaml"), source);
  writeFileSync(join(cwd, "deployment.json"), JSON.stringify(record));
  return { cwd, result: spawnSync(process.execPath, [script, "deployment.json"], { cwd, encoding: "utf8" }) };
}
test("creates a static source from the actual receipt block and preserves the original manifest", () => {
  const { cwd, result } = run(metadata, manifest.replace(/\n/g, "\r\n"));
  assert.equal(result.status, 0, result.stderr);
  const generated = readFileSync(join(cwd, "subgraph.tips.yaml"), "utf8");
  assert.match(generated, /startBlock: 12345/);
  assert.ok(generated.indexOf(metadata.address) < generated.indexOf("templates:"));
  assert.equal(readFileSync(join(cwd, "subgraph.yaml"), "utf8"), manifest.replace(/\n/g, "\r\n"));
});
test("rejects wrong chains, token/engine mismatch, zero addresses and missing receipt metadata", () => {
  for (const overrides of [{ chainId: 42161 }, { token: metadata.address }, { engine: metadata.address },
    { address: `0x${"0".repeat(40)}` }, { recipient: "invalid" }, { transactionHash: "" }, { startBlock: 0 }]) {
    assert.notEqual(run({ ...metadata, ...overrides }).result.status, 0);
  }
});
