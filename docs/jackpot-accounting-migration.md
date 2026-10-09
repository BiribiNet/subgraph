# Jackpot accounting separation

## Corrected semantics

- Treasury outflows debit `currentJackpot` and the daily pool snapshot directly in
  the BRB Transfer handler, even when no legacy bet/round can be identified.
  Attribution failure must not retain money that has left the treasury. A self-transfer
  changes neither funding nor payouts. Missing baseline balances still clamp at zero;
  this counter is not a replacement for an authoritative RPC balance.

- `RouletteBet.actualPayout`, `RouletteBet.won`, `UserMarketStats.totalWon`
  and its win count describe regular roulette payments in the market asset.
- `User.totalWon` and `winCount` also exclude jackpots. These legacy cross-market
  totals still normalize decimals only, not market prices; they are not BRB P&L.
- BRB jackpot payments remain available in `JackpotPayout`, including the existing
  user and bet relations. `GlobalState.totalJackpotsPaid` remains the BRB total.
- `DailyStat.jackpotFunded` counts actual BRB receipts at the treasury, recorded
  by the BRB Transfer mapping. `RouletteRound.jackpotRevenue` keeps market-asset
  inputs to the funder. Input and output must not be added together.

For example, a 5 USDC roulette payment plus a 2 BRB jackpot is reported as
5 USDC in the ticket/market roulette totals and a separate 2 BRB receipt.
A jackpot arriving first must not consume the regular roulette win counter.

## Deployment and historical data

This changes mapping semantics and requires a full replay from the configured
start block in a NEW staging deployment. Existing historical rows are not repaired
by a frontend deployment or by resuming indexing at the latest block.

Before moving the production alias:
1. Wait for staging to sync with no indexing errors.
2. At the same block, compare each bet's `actualPayout` with the sum of its
   `payoutTransactions.amount`, excluding `jackpotPayouts`.
3. Check mixed-asset winners (USDC and DAI) and BRB-market winners; inspect both
   transfer orderings. Reconcile jackpot receipts to `totalJackpotsPaid`.
4. Reconcile daily funding to BRB Transfer events whose destination is the
   treasury, including days with market funding but no treasury receipt.
   Check an outgoing transfer with no indexed ticket and ensure the pool falls once
   without manufacturing a JackpotPayout. Check self-transfers leave the pool unchanged.
5. Run `yarn reconcile:vaults` against staging at a pinned block.
6. Verify the frontend regular-win and jackpot receipt views, then switch its
   endpoint/alias. Retain the previous deployment for rollback; do not prune it.

No endpoint change, reindex deployment, wallet transaction or alias switch is
included in this code change. The automatic deploy script tags prod and prunes;
do not use that shortcut for this staged migration.

## Scope limits

The existing treasury-transfer association picks the first participating market
when the ERC-20 receipt does not identify a market. This change does not prove
that association. Jackpot receipts are BRB evidence, not per-market earnings.
Legacy global multi-token aggregates and annualized-return methodology remain
separate audit items. Missing MarketDailyStat writers also remain unresolved.

