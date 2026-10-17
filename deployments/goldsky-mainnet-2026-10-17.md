# Goldsky mainnet index inspection, October 17

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
