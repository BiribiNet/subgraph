# Mainnet webhook authentication

Each Goldsky pipeline has one independent random credential. Generate at least 32 random bytes for each value. Store values only in the receiver secret store and Goldsky `httpauth` secrets; pipeline YAML contains secret names only.

| Pipeline | Goldsky secret | Receiver setting | Endpoint |
| --- | --- | --- | --- |
| biribi-cre-countdown | BIRIBI_MAINNET_COUNTDOWN | Worker MAINNET_COUNTDOWN_WEBHOOK_SECRET | /webhook |
| biribi-keeper-payout | BIRIBI_MAINNET_PAYOUT | Worker MAINNET_PAYOUT_WEBHOOK_SECRET | /webhook/payout |
| biribi-roulette-events | BIRIBI_MAINNET_MIRROR | Frontend server MIRROR_API_SECRET | /api/mirror |

For all three Goldsky secrets use type `httpauth`, `secretKey: Authorization`, and `secretValue: Bearer <independent credential>`. Do not also set Authorization under sink `headers`. See [Goldsky webhook documentation](https://docs.goldsky.com/turbo-pipelines/sinks/webhook#secret-creation).

The frontend authenticates the incoming Goldsky request before publishing to Ably. Its Ably API key remains a separate provider credential. No secret belongs in browser code or NEXT_PUBLIC variables. The existing frontend accepts Authorization bearer authentication. Strict rejection of query values and X-Mirror-Secret is pending the separate frontend deployment described below.

The worker rejects missing, short or identical countdown/payout secrets. Each route validates only its own credential. The retired MAINNET_WEBHOOK_SECRET is ignored. The deploy script reads distinct countdownWebhookSecret and payoutWebhookSecret from the ignored scripts/constants/arbitrumOne.local.json file and rejects unmigrated keeperWebhookSecret. The keeper signer key, Durable Object identity and transaction journal remain independent of webhook authentication.

## Coordinated migration

1. Verify Goldsky project brb with the guarded goldsky-project.mjs helper. Save private, permission-restricted backups of all three current definitions and receiver configuration.
2. Create three independent Goldsky httpauth secrets. Configure the matching receiver values. Pause the affected Goldsky pipelines during a receiver change, or coordinate the update so authentication failures do not fail a live pipeline. Keeper alarms and the recovery cron continue independently of Goldsky.
3. Deploy the receiver changes, preserving the mainnet Durable Object and its signed transaction recovery state. Verify health and each route's own credential; verify swapped/retired credentials receive 401.
4. Apply authentication-only definitions from withWebhookAuth in scripts/webhook-auth.mjs. This preserves source names, checkpoints, SQL and batching. Never reset stream positions to rotate authentication. Validate all definitions before applying any. Mirror URL must be exactly https://biribi.net/api/mirror with no query.
5. Resume and confirm all three pipelines run. Check real delivery and Ably publication without logging credentials. Deploy strict frontend authentication after the mirror sends the header; the previous frontend already accepts Authorization bearer authentication.
6. Rotate the old URL-carried mirror credential as part of the receiver update, then retire the shared keeper secret after confirming no pipeline references it. Do not treat deletion of a URL parameter as revocation of its old value.

The generic testnet templates use separate environment credentials; do not repoint a legacy testnet watcher to the mainnet secrets. Existing deployment reports are historical evidence, not a claim that these source changes are active.

## Verified state on 2026-10-16

The live migration is complete for Goldsky and the mainnet keeper: all three pipelines are ACTIVE with one ready replica, clean URLs and their dedicated httpauth secrets. Countdown and payout have fresh independent values; the mirror uses its existing independent receiver value in BIRIBI_MAINNET_MIRROR. The shared BIRIBI_MAINNET_KEEPER_WAKE and Worker MAINNET_WEBHOOK_SECRET have been removed. Live checks accept each pipeline's own credential and reject both other pipeline credentials and the old shared credential. Sources and transforms were preserved, and keeper health is HTTP 200.

The mirror credential has not been rotated, and strict frontend query/custom-header rejection is tested locally but not deployed. The saved Vercel login cannot access the production frontend project. These two receiver changes remain pending production Vercel access; the live frontend already accepts the Authorization header used by the migrated pipeline. Evidence: [sanitized verification report](../deployments/goldsky-webhook-auth-2026-10-16.json).
