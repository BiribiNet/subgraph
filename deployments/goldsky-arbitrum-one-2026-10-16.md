# Arbitrum One Goldsky release

> Historical October 16 evidence. For current release commands and private endpoints,
> follow [DEPLOY.md](../DEPLOY.md). The later authentication migration is recorded in
> [webhook-authentication.md](../docs/webhook-authentication.md); the shared keeper
> credential described below has been retired. Public query access described here
> must not be assumed to remain enabled. The public configuration snapshots mentioned
> below are retained in local backups; regenerate templates with current tooling.

The authenticated project is `brb` (`project_cmfbfxud380il01v04gey3ym6`).
`biribi-arbitrum-one/1.0.0` is healthy, synchronized and promoted to its own
`prod` alias. Existing Sepolia subgraph versions and their alias remain intact.

Mainnet GraphQL:
https://api.goldsky.com/api/public/project_cmfbfxud380il01v04gey3ym6/subgraphs/biribi-arbitrum-one/prod/gn

Market order is BRB 1, USDC 2, DAI 3. At block 515402792, each indexed vault's
assets and shares matched the chain exactly: 300,000 BRB, zero USDC, zero DAI.
The index also confirms the dedicated keeper's executor approval. The build
uses the verified deployment's compiled ABIs, including the non-indexed executor
approval and identified/processed/skipped withdrawal events. All 247 mapping
tests and seven project/promotion guard tests passed.

The user-approved `biribi-roulette-events` pipeline now reads
`arbitrum_one.raw_logs` and delivers to the existing `https://biribi.net/api/mirror`
destination using its unchanged authentication. The new source key
`raw_logs_arbitrum_one` starts at `latest`, avoiding Sepolia checkpoint reuse and
historical notification replay. Historical accounting is served by the subgraph.
Goldsky validation passed; runtime logs show live mainnet reads with 1–3 seconds
of lag and completed checkpoints. These checks do not establish delivery of an
actual signed mainnet betting/VRF lifecycle.

The mainnet Cloudflare keeper is autonomous. In the subsequent October 16 update,
authenticated `/webhook` and `/webhook/payout` wake-up routes were added and the
existing `biribi-cre-countdown` and `biribi-keeper-payout` pipelines were switched
to Arbitrum One. They use `BIRIBI_MAINNET_KEEPER_WAKE`, a dedicated HTTP auth secret,
and share the existing durable signer. Missing/wrong credentials return 401;
the actual Goldsky credential returns 202. Neither pipeline invokes CRE, and
polling/cron continue independently of their delivery. All three pipelines are
running on mainnet; no active pipeline remains on Sepolia.

`turbo-arbitrum-one.yaml` is the redacted public configuration. Its authentication
placeholders must not be applied literally. Private before/after definitions and
the exact compiled release snapshot are saved in the workspace's `local-backups`.

## Subsequent releases

Generate a fresh isolated directory from `deployments/arbitrum-one.json` with
`scripts/prepare-environment.mjs`, then run `graph codegen` and `graph build` there.
`GOLDSKY_BUILD_DIR` selects that build when running `scripts/goldsky-deploy.mjs`.
Always use a new immutable version under `biribi-arbitrum-one`, validate its
health and exact-block vault balances, then promote with `goldsky-promote.mjs`.
The deployment and promotion tools verify the authenticated BRB project; the
deployment tool also rejects a mixed-network build.

For pipeline changes, use `mainnet-events-pipeline.mjs validate` followed by
`apply`, passing the manifest, generated ABI directory and a fresh private backup
path. It reads and preserves the current mirror authentication without printing
it. Do not run the legacy Sepolia `sync:pipeline` flow against the live events
pipeline: that flow targets the same name and would restore Sepolia settings.

## Remaining frontend cutover

Only the contracts Git history was merged, as requested. Subgraph and frontend
histories were not merged. The existing subgraph working tree was used to build
this isolated release.

The public `biribi.net/api/subgraph` endpoint still returns Sepolia markets.
Its server/public subgraph URLs and mainnet chain/address configuration need a
separate frontend deployment. This also matters for mirror token-decimal lookup:
an unknown USDC bank otherwise falls back to 18 decimals. No frontend changes or
deployment were performed in this reconciliation.

Machine-readable evidence: `goldsky-arbitrum-one-release-2026-10-16.json`.
