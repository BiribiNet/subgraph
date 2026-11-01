# Attributed BRB tips

`Tip` is an immutable transaction-hash/log-index record emitted only by TipJar.TipSent.
It contains jar, sender, token, recipient, raw amount, timestamp, block and transaction hash.
`TipTotal` aggregates amount/count by jar + token + recipient. It never alters fees,
vault balances or wagers. BRB's existing Transfer mapping still
updates balances; those transfers and Tip records overlap and must not be added together.

The manifest includes a configured Sepolia TipJar source and a reusable template. Mainnet preparation only includes an explicitly deployed jar; there is no
invented deployment address. It does not discover or activate arbitrary third-party jars.

After an authorized deployment of the contracts repository's TipJar, verify the metadata
against the successful on-chain receipt, constructor and getters, then run:

    node scripts/configure-tips.mjs ../contracts/deployments/tip-jar-<network>.json
    yarn graph codegen subgraph.tips.yaml
    yarn graph build subgraph.tips.yaml

The generator rejects zero/malformed addresses, missing receipt metadata, incompatible
networks and a token/engine different from the current manifest. It adds a static source
from the actual deployment block to `subgraph.tips.yaml`; the default manifest is untouched.
Deploy the generated **build** to a separate staging version using the existing documented
Goldsky workflow. Existing release scripts rebuild subgraph.yaml, so do not invoke those
unchanged for activation: either promote the verified generated build, or review/commit its
static TipJar source into the canonical manifest first. Keep its network/startBlock aligned.

Wait for sync; verify a known receipt matches exactly one Tip and the appropriate TipTotal.
Compare existing protocol accounting before promotion. Only then set the frontend's
NEXT_PUBLIC_TIP_JAR_ADDRESS and rebuild. An old indexer without tips reports history
unavailable, never a zero contribution total. Legacy direct transfers remain available
through brbTransfers and cannot prove that the Play button was used.

`yarn test` automatically includes tests/tips.test.ts on the existing Linux CI runner.
Local Windows builds compile the mapping; the Matchstick runtime requires Linux/Docker.

## Tip points (approved rate: 1 BRB = 3 BRBpoints)

User.totalTipsSent and tipCount accumulate eligible TipSent events from explicitly
configured TipJar sources only. The canonical 18-decimal BRB token is required; zero
senders/recipients and self payments do not award points. Other-asset records stay in
Tip/TipTotal for evidence but do not touch User. Hash + log index deduplication precedes
all accounting. Ordinary Transfer, Approval, protocol fees, staking deposits and legacy
direct payments do not award tip points. No untrusted jar discovery or extra RPC is added.

BRBPointsConfig.tipWeight defaults to 3. User.tipPoints is floor(totalTipsSent * 3 / 1e18),
rounded only after cumulative aggregation; the authoritative score adds that component
to the existing wager/stake/referral formula. Tier and daily snapshots update together.
As User.brbpPoints is also the DAO voting oracle, eligible tips now contribute to that
weight. Token balances, bets, vault accounting, payouts and winning odds are unchanged.

Release requires a fresh indexed version from the configured sources and start blocks;
do not graft old entities missing these required fields. Reindexing credits historical
eligible TipSent events once. Past plain transfers cannot establish tip intent and are
not backfilled. Verify amount/count, duplicate handling, score, tier and daily snapshots
on a staging endpoint before production promotion. Source merge alone does not update
the active index. Old endpoints must report the new statistics as unavailable.
