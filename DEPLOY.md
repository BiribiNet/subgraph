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

```bash
# codegen + build + deploy the bundle to Goldsky
yarn deploy:api biribi/<version>

# deploy and move the `prod` tag to this version in one go
yarn deploy:api biribi/<version> --tag prod --description "referral indexing"
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
