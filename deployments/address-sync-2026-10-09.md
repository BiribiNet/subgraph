# Arbitrum Sepolia address synchronization — 2026-10-09

Goldsky project: `brb`, `project_cmfbfxud380il01v04gey3ym6`.

This release follows the synchronous funding contracts deployed from the PR 39–42
release. It does not deploy or enable the later asynchronous funding changes.

## Subgraph

- Candidate `biribi/0.1.55` deployed successfully, healthy and replaying history.
- `prod` remains on `0.1.54` until indexing and same-block validation complete.
- Active funder: `0xfB5075174cb85aDfBf0A4E946840CbFD03bF48a2`, block `317422007`.
- Previous funder: `0x6aF569259B87ef2AE4998436047fdFAfaEeDc7d9`, block `317414249`.
- Original funder history is retained from block `284788460`.
- Verified TipJar is indexed from its receipt block `317414260`.
- No old deployment has been deleted; `0.1.54` is the rollback version.

Local one-time completion operation:
`/private/tmp/biribi-finish-subgraph-20261009.py`.
Status: `/private/tmp/biribi-goldsky-0.1.55-status.json`.
Comparison: `/private/tmp/biribi-goldsky-0.1.55-comparison.log`.
It only moves `prod` after healthy synchronization, the repository's same-block
non-regression gate, unchanged governance weights and query fields, and an
indexed attempt from the active funder. It refuses to overwrite another release.
It creates no permanent service and does not prune the rollback deployment.

## Turbo

`biribi-roulette-events` updated through the validated Turbo API definition:
new funder addresses added and missing funding events added to its decoder.
The deployed definition was read back and matched the candidate exactly.
Sources and sinks were preserved. All three pipelines report `Running` with
one ready replica. `biribi-cre-countdown` and `biribi-keeper-payout` continue
watching the unchanged engine proxy.

## Frontend

Frontend commit `7061aa53dce8d12356a995228265e671eb001eab` is on master.
The contract registry discovers the funder from the engine rather than using
a stale environment value. Vercel Production and Preview now configure the
active funder above. Production redeployment
`Gg8Cj4tfY1PCajs2mBxRwNBM88rR` is Ready and serves `biribi.net`.
The private subgraph URL uses the stable `biribi/prod/gn` endpoint already.

## Verification

- Matchstick 0.6.0: all 246 mapping tests passed.
- TipJar manifest generator: all 3 tests passed, including regeneration.
- Constants check, code generation and subgraph build passed.
- Frontend: 164 existing targeted tests plus 2 registry regression tests passed;
  TypeScript and targeted ESLint passed before publication.
