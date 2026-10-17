# Goldsky mainnet index inspection, October 17

## Operational follow-up

Mainnet candidate `biribi-arbitrum-one/1.1.0` was accepted in workflow
`39042927933` at source commit `56c07d7ce345b8dbbce9b1b25f79bd9b538882eb`.
The workflow passed its project preflight, release tests, codegen/Matchstick,
isolated mainnet codegen/WASM compilation and private-only endpoint readback.
This is a deployed indexing candidate; it does not prove synchronized history
or approve the website's public activation. The existing `prod` alias is retained.

The manual `deploy-goldsky.yml` workflow provides credential-contained
inspection, validation and promotion. Select the explicit network/version and
the observed existing `prod` version for comparison. It checks private endpoint
identity, full synchronization, errors, exact canonical markets and RPC chain;
then compares both versions at one block and reconciles every vault with zero
tolerance before promotion. A fresh alias check prevents overwriting a changed
release, and the promoted content hash/privacy are read back. Deployment and
release verification share a per-network concurrency group. The status artifact
contains public index observations and no token.

`restore-testnet` is limited to Sepolia and an absent `prod` alias. It requires
indexed placement receipts, exact canonical markets and zero-drift vault
reconciliation, without inventing a deleted rollback baseline or skipping
history. It cannot overwrite an existing alias or restore over mainnet.

The existing GitHub `goldsky-testnet` credential successfully authenticated
project **brb** and submitted a separate Sepolia restoration at master commit
`b72a7057029081119c84c596ed53ba0a623715d3` (run `39041906593`). This is a
BRB-project administration key, independent of the deployed network. The release
workflow now lets the operator explicitly select its credential location;
the default retains this existing location. A `goldsky-mainnet` key can be used
instead when configured. This does not copy a secret, expand its Goldsky scope,
or change chain selection. The generated build/name/network guards still bind
mainnet to `biribi-arbitrum-one` and Sepolia to `biribi`. Runtime query, Ably,
mirror and cron credentials still require separate environment configuration.
The earlier missing-key failure below does not require creating another admin
credential merely to deploy the corrected mainnet candidate.

`biribi/validation-restore-20261017` was accepted and is reindexing from the
original block 284788460. No history was skipped and `prod` has not moved.
Goldsky initially created a public endpoint; dashboard controls enabled its
private endpoint and disabled its public endpoint. Both flags were read back.
The scripts now perform this restriction and verify the readback immediately
after accepting a deployment, before reporting success. Goldsky's creation API
defaults mean a newly submitted version can briefly be public before the
update; this workflow does not claim atomic private creation. No service
credentials are indexed by the mappings.

Promotion requires a healthy, synchronized, private-only candidate. It verifies
and restricts the `prod` alias after moving it, because a newly created tag can
also default to public. An uncertain privacy update fails closed and requires
inspection; it never redeploys, retries a tag change or deletes a version.

Authenticated dashboard inspection confirmed project **brb**,
`project_cmfbfxud380il01v04gey3ym6`. Its All subgraphs list contains only
`biribi-arbitrum-one/1.0.0`, deployed October 16 at 14:42 UTC. It is Live on
Arbitrum One and caught up at block 515697514 during inspection. The Entities
view contains three markets/banks, 21 role holders and one executor approval.
These observations do not validate payment events: there are no roulette bets
or payment receipts in that deployment yet.

Both the version endpoint and the `prod` tag have private endpoints enabled;
public endpoints are disabled. Keep this protection. The confirmed alias is:

`https://api.goldsky.com/api/private/project_cmfbfxud380il01v04gey3ym6/subgraphs/biribi-arbitrum-one/prod/gn`

The website still uses its Sepolia build and its `/api/subgraph` proxy returns
Goldsky 404, Subgraph not found. The former `biribi` subgraph does not appear in
the All list. This establishes a missing configured upstream, not who deleted
or moved it. Do not point a running Sepolia game at mainnet data.

## Updated release workflow

`deploy-goldsky.yml` now accepts an explicit `network` choice, defaulting to
testnet. Mainnet selects the `goldsky-mainnet` GitHub environment, verifies the
BRB credential before installing dependencies, generates an isolated source
tree from the verified mainnet manifest/ABI profile, compiles it and submits an
immutable, untagged `biribi-arbitrum-one/<version>` deployment. Existing tags
and deployments are retained. Use a fresh version such as `1.1.0` only after
checking that it does not already exist.

Use the existing GitHub Actions Goldsky credential; never put it in workflow
inputs, logs or public settings. A browser login does not authenticate the CLI.
If the environment lacks a credential, fail rather than export a browser token
or weaken endpoint protection.

After synchronization, compare the candidate with the chain, inspect handler
errors and validate the mainnet withdrawal/payment layouts. Promotion remains
separate using the guarded promotion script or the authenticated dashboard in
the confirmed BRB project. Public website cutover additionally requires its
mainnet services and lifecycle validation.

## Attempted submission

The workflow was manually dispatched on the reviewed branch at commit
`b025c3cd9abca24332535a41a792f660a45ba022`, explicitly selecting `mainnet`
and version `1.1.0` (run `39041191608`). It stopped at the credential preflight:
`GOLDSKY_API_TOKEN` is absent from `goldsky-mainnet`. No build or Goldsky
submission occurred. The environment exists but has no secrets. Add the BRB
project credential through GitHub's encrypted environment secret form and
rerun; do not paste it in an issue, PR, chat or workflow input. The independent
CI test/codegen/Matchstick/build run `39041095505` passed.
