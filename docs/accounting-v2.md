# Accounting v2 migration

Full reindex required. Deploy with `Stage accounting validation`; it creates a new
version without moving prod, overwriting history, or pruning old deployments.
Wait for indexing to finish and reconcile vaults at a common block before promotion.

`MarketDailyStat` (UTC day), `MarketAccountingStat` (`hour-H-M` and `total-M`)
contain **raw units of market M's token**. Never sum different assets as a monetary
amount. Lifetime date/timestamp zero denotes an all-history bucket, not an event date.
Unique players refer to wagers, not deposits. Source/category markers prevent retries
from incrementing aggregates twice.

`netRevenue = settled wagers - regular roulette payouts` is signed. `revenue` is the
sum of positive round results; `losses` is the magnitude of negative round results.
`stakersRevenue` is positive revenue less market fees; it is not an investment return.
`jackpotFunded` here is the market-token input to the funder. Global daily BRB treasury
receipts and burns are different measurements and must not be substituted for it.
Deposits and withdrawals are capital flows, not revenue. Jackpot payouts are separate
from roulette winnings.

`MarketReturnObservation` uses simple annualized share-price change (APR), not
compound APY. Rates are percentages. Each window provides the actual baseline time;
lookback can extend by six days when events are sparse. Missing baseline => null,
never a lifetime fallback. Zero NAV with outstanding shares means a loss. No shares
or nonpositive baseline => unavailable. Calculation version is 2.

Consumers must feature-detect the new schema or be released after endpoint promotion.
Old `Market.apy*` fields remain compatible, but must not be labeled as compound APY.
No published index or contract is upgraded merely by merging this source change.
