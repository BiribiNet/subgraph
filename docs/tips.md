# Attributed BRB tips

`Tip` is an immutable transaction-hash/log-index record emitted only by TipJar.TipSent.
It contains jar, sender, token, recipient, raw amount, timestamp, block and transaction hash.
`TipTotal` aggregates amount/count by jar + token + recipient. It never alters fees,
vault balances, wagers, user points or governance. BRB's existing Transfer mapping still
updates balances; those transfers and Tip records overlap and must not be added together.

The manifest includes a **dormant template** so codegen/build/tests compile without any
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
