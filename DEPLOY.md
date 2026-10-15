# Goldsky release workflow

Production Arbitrum One and retained Sepolia share the **brb** project (`project_cmfbfxud380il01v04gey3ym6`) but use different subgraph names:

| Chain | Subgraph |
| --- | --- |
| Arbitrum Sepolia | Existing `biribi/prod` |
| Arbitrum One | New `biribi-arbitrum-one/prod` |

Every provided Goldsky administrative release entrypoint verifies the active credential's project ID and name before remote work. Use `GOLDSKY_API_TOKEN` (legacy `GOLDSKY_TOKEN` or saved BRB login is supported where indicated). Never print or commit tokens. Raw Goldsky CLI commands bypass these safeguards.

## Existing testnet release

Use Node 22 and immutable dependencies. Choose an unused version explicitly. The manual GitHub release workflow is scoped to `goldsky-testnet`; configure its required reviewers in GitHub settings.

```sh
yarn test:release
yarn check:constants
yarn codegen
yarn graph test -v 0.6.0
yarn build
VERSION=0.1.56 node scripts/goldsky-release.mjs
```

The example version is not a claim about current live state. Submission is immutable and **untagged**. No automatic prod movement or pruning remains in release or legacy sync. Wait for healthy, synced indexing with no errors. Check the actual current prod target in BRB; pass it explicitly to accounting comparison:

```sh
node scripts/validate-deploy.mjs <actual-live-version> <candidate-version>
SUBGRAPH_URL=<candidate-proxy-url> RPC_URL=<same-chain-rpc> node scripts/reconcile-vaults.mjs deployments/arbitrum-sepolia.json
node scripts/goldsky-promote.mjs biribi/<candidate-version> --validated
```

Review accounting/governance changes, save same-block reconciliation evidence and confirm rollback target first. `--validated` acknowledges that review; it is not a replacement for it. Promotion also checks indexing health/sync/errors. Verify the prod alias after promotion and retain prior deployments. Candidate private endpoints need appropriate authentication or a secured proxy. Do not remove endpoint protections to run a check.

## New mainnet release

The 2026-10-15 public candidate in `deployments/arbitrum-one.json` uses one BRB
market and direct keeper automation. It omits AutomationReceiver and includes the
explicit mainnet TipJar. Start block 515103224 is the successful BRB mint/deploy
receipt, before the engine, registry registration and bank creation. Sepolia
source files and `biribi/prod` stay unchanged.

For **local compilation/review only**, incomplete handoff evidence can be kept
visible while preparing an isolated candidate:

```sh
node scripts/prepare-environment.mjs deployments/arbitrum-one.json <new-source-directory> --candidate
node scripts/prepare-mainnet-pipelines.mjs deployments/arbitrum-one.json <new-pipeline-directory>
```

`--candidate` never changes deployment flags or contacts Goldsky. Its output is
not launch approval. The generated pipeline templates use separate mainnet names,
`arbitrum_one.raw_logs`, the supplied worker's `/webhook` and `/webhook/payout`,
and `BIRIBI_MAINNET_SCHEDULE` (a separately provisioned Bearer credential).
They preserve the mirror secret placeholder for secure substitution and start
at `latest` to avoid replaying historical events into live clients/keepers.
Dataset reference: https://app.goldsky.com/explore/dataset/raw_logs

Verify the `brb` project before any remote operation, validate the templates,
review current indexing/service costs, configure isolated mainnet secrets and
record rollback targets. No live pipelines were applied by this preparation.
After publishing an untagged candidate, reconcile market 1, token balances,
placements, revenue and payouts against mainnet receipts before promotion.
Reconcile the actual deployed ABIs/source revisions: bytecode sizes differ from
the dated repository rehearsal and compilation alone cannot establish identity.

Follow [the cross-repository mainnet runbook](../contracts/docs/MAINNET_RUNBOOK.md) and [readiness findings](../contracts/docs/MAINNET_REVIEW_2026-10-09.md). Public launch is held on unresolved security/rehearsal gates.

```sh
node scripts/prepare-environment.mjs ../contracts/deployments/arbitrum-one.json /tmp/biribi-mainnet-release
cd /tmp/biribi-mainnet-release
node node_modules/@graphprotocol/graph-cli/bin/run.js codegen
node node_modules/@graphprotocol/graph-cli/bin/run.js build
```

Return to this repository, then use an unused immutable version:

```sh
GOLDSKY_BUILD_DIR=/tmp/biribi-mainnet-release/build node scripts/goldsky-deploy.mjs biribi-arbitrum-one/1.0.0
# After healthy/synced indexing and reviewed mainnet accounting reconciliation:
node scripts/goldsky-promote.mjs biribi-arbitrum-one/1.0.0 --validated
```

The exporter never patches Sepolia source files. It rewrites every source/template network, address, constant and start block; removes historical Sepolia funders and optional TipJar from the fresh mainnet. Add TipJar explicitly if in scope. First-release reconciliation compares chain events/receipts to the candidate; do not compare mainnet to testnet totals. For subsequent mainnet upgrades, set `GOLDSKY_SUBGRAPH_NAME=biribi-arbitrum-one` and pass explicit live/candidate versions to `validate-deploy.mjs`.

Mainnet Turbo pipelines are a separate provisioning step: new names, mainnet source/addresses and isolated worker/webhook/Ably sinks. Validate before apply. Legacy `sync:pipeline` is testnet-only, requires the CLI login to match the verified credential, fails on Turbo validation errors, and retains rollback versions. Do not use it to provision mainnet.

For the existing mirror pipeline, set `MIRROR_API_SECRET` in this repository's local `.env` to the frontend's `MIRROR_API_SECRET` for `biribi.net`. The sync script URL-encodes it in the mirror sink. The round-watcher uses a separate Worker `WEBHOOK_SECRET` through Goldsky's `BIRIBI_CRE_SCHEDULE` secret; never substitute that credential into the website mirror. Generated `*.applied.yaml` files contain credentials and must not be committed or reused after a secret change.

Deploy requests are not automatically retried after uncertain transport failures. Inspect the BRB dashboard before recovery. Deployment and promotion are deliberately separate operations. Existing `biribi/prod`, Sepolia Turbo pipelines and workers remain test infrastructure.
