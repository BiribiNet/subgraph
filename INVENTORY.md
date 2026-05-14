# Subgraph INVENTORY — current state vs `contracts @ markets`

Snapshot: `subgraph @ master @ 2d083424` indexed against
`contracts @ master @ 43820243` (legacy single-asset architecture).

The new mainnet contracts were deployed from `contracts @ markets @ 045b14c9`
(multi-asset architecture). The subgraph in its current form is **not
compatible** with those contracts.

## Currently indexed (legacy, will be removed)

Network: **`arbitrum-sepolia`** (testnet, not production).

| Data source     | Address (sepolia)                                 | ABI file                        |
|-----------------|---------------------------------------------------|---------------------------------|
| `BRBToken`      | `0x2b6897a9e0d78c59a35564d93fd0a2ae745d0654`     | `abis/BRB.json`                 |
| `RouletteClean` | `0x21dec65fa9d516711004eda8d463c86db90e080d`     | `abis/Game.json`                |
| `StakedBRB`     | `0x522f98efd29cd9350f5c96961a418953fdf1039b`     | `abis/MergedEvents.json`        |
| `BRBReferal`    | `0x48e85e0f774f0d0d44519b13a959d9faa78e831b`     | `abis/BRBReferal.json`          |

Mappings:
- `src/mappings/brb.ts` — BRB Transfer + Approval (ERC-20 standard; should
  remain valid against the new `BRBToken` since its events are standard).
- `src/mappings/roulette.ts` — `RouletteClean` events
  (`ComputedPayouts`, `JackpotResultEvent`, `VRFResult`, `BatchProcessed`,
  `RoleGranted`/`Revoked`/`AdminChanged`, etc.). These signatures do not
  exist on the new `RouletteEngine`.
- `src/mappings/stakedBRB.ts` — `StakedBRB` MergedEvents
  (`RoundCleaningCompleted`, `BettingWindowClosed`, `LiquidityEscrowSet`,
  `QueuedLiquidityRejected`, `WithdrawalEjected(address,uint8)`,
  `BurnFeeRateUpdated`, `JackpotFeeRateUpdated`, `ProtocolFeeRateUpdated`,
  `FirstBetPlaced`, `BetPlaced(address,uint256,bytes,uint256)`,
  `WithdrawalRequested(address,uint256)`, `MaxSupportedBetsUpdated`,
  `AntiSpamSettingsUpdated`, `CleaningUpkeepRegistered`,
  `UpkeepRegistered(indexed uint256,…,string)`). None of these exist on
  `BankVault4626`.
- `src/mappings/brbReferal.ts` — Transfer + Approval for the legacy
  referral token. **The new protocol has no referral contract on
  `markets`**, so this data source is dead unless / until prompt 4
  re-introduces `BRBreferral`.

Entities (`schema.graphql`):
- Single-asset assumptions baked in: `User.brbBalance`, `sbrbBalance`,
  `brbReferalBalance`, `totalStaked`, `cumulativeDepositValue`,
  `apy7Day/30Day/365Day/Lifetime`, `currentJackpot`, `feeRecipient`,
  `liquidityEscrow`, etc. No notion of `marketId`, `BankVault4626`
  identity, `JackpotTreasury`, or `BRBJackpotFunder`.
- `RouletteBet` keyed by `user + round` instead of
  `(marketId, roundId, player, betType, number)` as the new engine
  produces.

## What must be wired to track the production deployment

### Network
`arbitrum-one` (production). All `startBlock` values must be reset to
each contract's actual deployment block. As of this audit, we do not have
on-chain confirmation of the exact deploy blocks — fill them in from
Arbiscan before deploy.

### New data sources (one per contract, all on `arbitrum-one`)

| Data source       | Address                                       | ABI to add               |
|-------------------|-----------------------------------------------|--------------------------|
| `MarketRegistry`  | `0x9a328b11c7189a8ba2af6186643f93204b516987`  | `MarketRegistry.json`    |
| `RouletteEngine`  | `0x60cd5a0f74f1644eaef997496e19e3737690ad1c`  | `RouletteEngine.json`    |
| `UpkeepScheduler` | `0x40a7f6d4e902f13e2d9e4754dee37648f2fcdfda`  | `UpkeepScheduler.json`   |
| `UpkeepManager`   | `0xdbfab262996d221c72eeb9f2e6679c3d2c7bc95b`  | `UpkeepManager.json`     |
| `JackpotTreasury` | `0xbbe4d51cf721277d52d916291f6de4fa972e5e22`  | `JackpotTreasury.json`   |
| `BRBToken`        | `0x47e054bb133e75b1c2c7a9a52ba73e52e75a06a1`  | `BRBToken.json` (reuse `BRB.json` shape) |
| `BRBJackpotFunder`| `0x60ce672feaf39f35a3f6e5b3e099f46b90aee9fc`  | `BRBJackpotFunder.json`  |

### Templates needed

`BankVault4626` proxies are deployed dynamically by
`MarketRegistry.createMarket`. They must be indexed via a
`dataSourceTemplate` triggered from a `MarketRegistry.MarketCreated(uint32
marketId, address asset, address bank)` handler.

### Event handlers to (re-)wire

Source of truth — see `contracts @ markets`:
- `MarketRegistry.sol`: `MarketRegistered`, `MarketCreated`,
  `VaultBeaconUpdated`, `EngineUpdated`.
- `RouletteEngine.sol`: `MarketRegistered`, `VrfRequested`, `VRFResult`,
  `RoundResolved`, `MinJackpotConditionUpdated`, `BetRecorded`,
  `RoundLocked`, `GlobalRoundSealed`, `PayoutProgress`, `JackpotFunded`,
  `InfrastructureFeePaid`, `WithdrawalQueueBatchSizeUpdated`,
  `MaxWithdrawalQueueLengthUpdated`.
- `BankVault4626.sol`: `BetPlaced(address,uint256,bytes,uint256)`,
  `MinBetUpdated`, `BetsReleased`, `PayoutBatchProcessed`,
  `FundsTransferred`, `WithdrawalRequested(address,uint8,address,uint256,uint256)`,
  `WithdrawalProcessed(address,uint8,address,uint256,uint256)`,
  `WithdrawalEjected(address,uint8)`, plus standard ERC-20 + ERC-4626
  events (`Transfer`, `Approval`, `Deposit`, `Withdraw`,
  `RoleGranted`/`Revoked`/`AdminChanged`, `Initialized`, `Upgraded`).
- `JackpotTreasury.sol`: `EngineSet` (plus internal BRB `Transfer`s
  caught via the BRBToken data source).
- `BRBJackpotFunder.sol`: `SwapAssetBpsUpdated`,
  `TreasuryBrbSplitUpdated`, `SlippageBpsUpdated`, `BrbRatioUpdated`,
  `FundFromMarketSkipped`, `JackpotTreasuryTransferFailed`,
  `JackpotBurnFailed`, `FundedFromMarket`.
- `UpkeepScheduler.sol`: `ScanLimitUpdated`,
  `MaxPayoutsPerCallUpdated`, `LaneCursorAdvanced`,
  `ForwarderAuthorityUpdated`.
- `UpkeepManager.sol`: `UpkeepRegistered(uint256,uint256,address,uint96)`.

### Schema changes (entity model)

Add at minimum:
- `Market { id: marketId, asset: Bytes, bank: Bytes, name, symbol, decimals,
  enabled, createdAt }`.
- `VaultState { id: bank, marketId, totalAssets, totalShares, sharePrice,
  lockedBetLiquidity, queueLength }` — one per market.
- `JackpotState { id, brbPool, totalFunded, totalBurned, lastFundedAt }`.
- `FunderConfig { id, swapAssetTotalBps, treasuryBrbNumerator,
  treasuryBrbDenominator, slippageBps }` + history.
- Replace `RouletteBet` with multi-market shape:
  `RouletteBet { id: marketId+roundId+player+betIndex, market, round,
  player, amount, betType, number, paidOut }`.
- Add `MarketRoundState`, `GlobalRoundState`, plus engine event log
  entities for `JackpotFunded`, `InfrastructureFeePaid`, `PayoutProgress`.

### Helpers to keep / extend

- `src/helpers/{aggregation,betting,bigintToBytes,constant,decodeWrapper,
  globalState,number,rouletteRound,user}.ts` — most carry over after
  schema refactor. `betting.ts` needs to decode the new bet payload
  (`(uint256[] betTypes, uint256[] numbers, uint256[] amounts)`).

## Test framework

`matchstick-as ^0.6.0` (Goldsky pipeline). Existing tests under `tests/`
(7 suites) will need updating for the new schema; do not delete them —
treat as a baseline for regression. Add new suites covering multi-market
behavior.

## What this commit changes

This audit pass only **documents** the gap and **does not break the
build**. Repointing `subgraph.yaml` to `arbitrum-one` with the new
addresses requires the corresponding ABI files and rewritten mappings,
which are out of scope for prompt 1 (the explicit guidance is to scaffold
empty mappings — see follow-up work).

See `AUDIT.md` for findings and `MIGRATION.md` for the step-by-step
plan that prompt 2 / prompt 4 will execute.
