# Deploying the Biribi subgraph to Goldsky

This subgraph deploys to **Goldsky** via the REST helper
`scripts/goldsky-deploy.mjs` (used by `yarn deploy:api`). The REST path is the
one to use in non-interactive environments (CI, Claude Code on the web) because
it avoids the Goldsky CLI's TTY/login prompts.

## 1. Connect Goldsky (one-time, secure)

The deploy needs a **Goldsky API token**. Get it from the Goldsky dashboard
(Settings → API keys: https://app.goldsky.com).

**Do not paste the token in chat or commit it.** Add it as an **environment
secret** so it is injected into the sandbox as an env var across sessions:

- **Claude Code on the web**: open your environment's configuration and add a
  secret named `GOLDSKY_API_TOKEN`. See
  https://code.claude.com/docs/en/claude-code-on-the-web for where environments,
  env vars and the **network policy** are configured.
- **Local / CI**: export `GOLDSKY_API_TOKEN` in the shell or CI secret store, or
  run `goldsky login` (writes `~/.goldsky/auth_token`, which the script also
  reads as a fallback).

> Network policy: deploying reaches `api.goldsky.com`. The environment's network
> policy must allow outbound HTTPS to that host, otherwise the deploy will fail.

## 2. Deploy

### From GitHub Actions (recommended)

The repo ships `.github/workflows/deploy-goldsky.yml`: run the **“Deploy
subgraph to Goldsky”** workflow (Actions → workflow_dispatch). It uses the
`GOLDSKY_API_TOKEN` repository secret and calls `scripts/goldsky-release.mjs`,
which codegens + builds, deploys the next patch version (or the `version`
input), moves the `prod` tag, then deletes superseded versions (uncheck the
`prune` input to keep them).

### From a shell

```bash
# codegen + build + deploy the bundle to Goldsky
yarn deploy:api biribi/<version>

# deploy and move the `prod` tag to this version in one go
yarn deploy:api biribi/<version> --tag prod --description "referral indexing"

# or the full release (auto version + prod tag + prune), same as CI
GOLDSKY_API_TOKEN=... node scripts/goldsky-release.mjs
```

`<version>` is your choice (e.g. `v2-referral`, `1.2.0`). On success the script
prints the deployment health and GraphQL endpoint.

The Goldsky CLI also works once the token is available
(`yarn goldsky subgraph list`, `yarn deploy <version>`); for the CLI path you can
materialise the token file with:

```bash
mkdir -p ~/.goldsky && printf '%s' "$GOLDSKY_API_TOKEN" > ~/.goldsky/auth_token
```

## 3. Verify referral indexing

Once synced, query the new endpoint to confirm the BRBReferral data source is
populating BRBr / BRBpoints:

```graphql
{
  users(first: 5, where: { totalBrbrEarned_gt: "0" }, orderBy: totalBrbrEarned, orderDirection: desc) {
    id
    totalBrbrEarned
    brbpPoints
    tier
    brbReferalTransfers(where: { isCredit: true }) { from value isCredit }
  }
}
```

Then point the frontend at the endpoint by setting `NEXT_PUBLIC_SUBGRAPH_URL`
(see `frontend/.env.example`) to the deployment's GraphQL URL.

---

## 4. Re-indexing from `startBlock` (data-correcting deploys)

Some fixes correct values that were written **wrongly into history**. Those only
take effect for blocks indexed *after* the fix unless the subgraph is rebuilt
from `startBlock`. As of the 2026-08 accounting work that applies to: non-BRB
market payout attribution, cross-market decimal normalization, and the staking
component of `brbpPoints`.

`brbpPoints` is the one that makes this urgent rather than cosmetic: Snapshot
reads it **at a proposal's snapshot block** via time-travel queries, so stale
history means stale voting power.

### ⚠️ Do not use the normal release path for this

`scripts/goldsky-release.mjs` (and the `deploy-goldsky.yml` workflow) deploys
**and moves the `prod` tag in the same run**, then prunes superseded versions by
default. Every new Goldsky version indexes from `startBlock`, so moving the tag
immediately would point the live endpoint at a version at ~0 % sync — empty
leaderboards, zeroed stats, missing history — and the prune would delete the
healthy version you would want to roll back to.

### Two-phase procedure

**Pre-flight** (all must pass before deploying):

```bash
yarn check:constants                # addresses + startBlocks match the deploy JSON
yarn codegen && yarn build          # zero warnings
npx graph test -v 0.6.0             # the -v pin is required; see note below
```

> The version pin is not optional: without it the CLI calls the GitHub "latest
> release" API to fetch its binary, which fails behind a proxy. `yarn test` runs
> `graph test` unpinned and is **not** a substitute for this step.

**Phase 1 — deploy untagged.** `prod` keeps serving the old version, so there is
no interruption:

```bash
yarn deploy:api biribi/<version>    # no --tag: goldsky-deploy defaults to no tags
```

**Phase 2 — wait for a full sync, then validate against the *new* version's
endpoint** (not `prod`):

1. Indexing health — `synced: true`, `health: healthy`, `fatalError: null`.
2. Payout attribution repaired — a winner in a non-BRB market now has
   `winCount > 0`. Query `users(where: { winCount_gt: 0 })` and confirm it
   includes addresses active on the USDC/DAI vaults, which was impossible before.
3. Decimal normalization repaired — `globalState.totalPayouts` and
   `totalStakerRevenue` are the same order of magnitude as `totalWagered` (all
   18-decimal). A ~10^12 gap means a regression.
4. Staking weight repaired — a USDC staker appears in the `totalStaked` ranking.
5. **Non-regression** — `totalRounds`, `totalBets` and `brbTotalSupply` must
   match the old version. No fix touches those counters, so any difference is an
   alarm, not an improvement.

**Phase 3 — cut over** only once the above holds:

```bash
yarn prod:subgraph <version>        # moves the prod tag; atomic for readers
```

The frontend needs **no** env change: it queries `/api/subgraph` (same-origin
proxy) → `SUBGRAPH_API_URL` → the `biribi/prod` tagged endpoint.

**Do not prune** the previous version until the new one has served production
for a while — it is the only rollback.

### Governance caveat

`brbpPoints` changes retroactively (upward) for USDC/DAI players. A Snapshot
proposal open across the cutover would see voting weight move under it. Cut over
outside any voting window, and announce it: a voter who sees their weight change
without explanation will read it as manipulation, not as a correction.
