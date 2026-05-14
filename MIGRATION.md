# Subgraph MIGRATION plan

How to bring the subgraph in line with `contracts @ markets` (production
deployment on Arbitrum). Ordered by execution. Each step is intended to
land as its own commit on `claude/biribi-project-prompts-SWffc`, then
get folded into prompts 2 / 4.

## 0. Preconditions

- `contracts @ markets` is the canonical source of truth.
- Production addresses (Arbitrum) listed in `INVENTORY.md`.
- Confirm exact deployment block per contract on Arbiscan
  (`getContractCreation`). Store the seven numbers in
  `scripts/startblocks.json` for reuse.

## 1. Import ABIs from the contracts repo

```bash
cd ../contracts
git checkout claude/biribi-project-prompts-SWffc
yarn install
yarn compile           # generates artifacts/abi.ts
node scripts/update-subgraph-abis.mjs ../subgraph/abis
```

This populates:
- `abis/BRBToken.json`
- `abis/MarketRegistry.json`
- `abis/RouletteEngine.json`
- `abis/BankVault4626.json`
- `abis/JackpotTreasury.json`
- `abis/BRBJackpotFunder.json`
- `abis/UpkeepScheduler.json`
- `abis/UpkeepManager.json`

Remove obsolete ABIs once mappings are migrated (`BRB.json`, `Game.json`,
`MergedEvents.json`, `StakedBRB.json`, `BRBReferal.json`).

## 2. Rewrite `subgraph.yaml`

```yaml
specVersion: 1.3.0
description: Biribi multi-market roulette (Arbitrum)
schema:
  file: ./schema.graphql
indexerHints:
  prune: auto
dataSources:
  - name: BRBToken
    kind: ethereum/contract
    network: arbitrum-one
    source:
      abi: BRBToken
      address: "0x47e054bb133e75b1c2c7a9a52ba73e52e75a06a1"
      startBlock: <TBD-from-arbiscan>
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./src/mappings/brbToken.ts
      entities: [User, BRBTransfer, ProtocolStats]
      abis:
        - name: BRBToken
          file: ./abis/BRBToken.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
        - event: Approval(indexed address,indexed address,uint256)
          handler: handleApproval
  - name: MarketRegistry
    kind: ethereum/contract
    network: arbitrum-one
    source:
      abi: MarketRegistry
      address: "0x9a328b11c7189a8ba2af6186643f93204b516987"
      startBlock: <TBD>
    mapping: { … }
  - name: RouletteEngine
    source: { address: "0x60cd5a0f74f1644eaef997496e19e3737690ad1c", … }
  - name: JackpotTreasury
    source: { address: "0xbbe4d51cf721277d52d916291f6de4fa972e5e22", … }
  - name: BRBJackpotFunder
    source: { address: "0x60ce672feaf39f35a3f6e5b3e099f46b90aee9fc", … }
  - name: UpkeepScheduler
    source: { address: "0x40a7f6d4e902f13e2d9e4754dee37648f2fcdfda", … }
  - name: UpkeepManager
    source: { address: "0xdbfab262996d221c72eeb9f2e6679c3d2c7bc95b", … }

templates:
  - name: BankVault4626
    kind: ethereum/contract
    network: arbitrum-one
    source:
      abi: BankVault4626
    mapping: { … }
```

Wire `MarketRegistry.MarketCreated(uint32 marketId, address asset, address bank)`
to instantiate the `BankVault4626` template with `bank` as the source
address.

## 3. Rewrite `schema.graphql`

Minimum new entities:

- `Market { id, marketId, asset, bank, shareName, shareSymbol, decimals,
  createdAt, enabled }`
- `VaultState { id (= bank), market, totalAssets, totalShares, sharePrice,
  lockedBetLiquidity, queueLength, queueHead, lastUpdatedAt }`
- `MarketDailyStat { id, market, day, volume, betCount, payouts, fees }`
- `GlobalRoundState { id (= roundId), phase, vrfRequested, vrfFulfilled,
  winningNumber, jackpotTriggered, jackpotDistributed, jackpotPoolSnapshot,
  jackpotPaid, jackpotTotalStake, lockAt, sealedAt, resolvedAt,
  participantMarkets: [Market!]! }`
- `MarketRoundState { id, market, round, totalAmount, betCount,
  payoutCursor, winningBetCount, bankPaidRunning, settled, betsReleased,
  marketWin, infraFee, jackpotFunded }`
- `RouletteBetItem { id (= round+market+player+seq), round, market,
  player, amount, betType, number, won, payout }`
- `JackpotFundingEvent { id, market, round, swapIn, brbOut, toTreasury,
  burned }`
- `FunderConfig { id (singleton), swapAssetTotalBps, treasuryBrbNumerator,
  treasuryBrbDenominator, slippageBps, updatedAt }`
- `MarketRatio { id (= market), ratio, updatedAt }`
- `AdminRoleChange`, `ContractUpgrade`, `UpkeepRegistration`, `ProtocolStats`
  (carry over, retarget contract enum).

Reserve `User.brbpPoints` field for prompt 4. Prompt 4 will introduce
`BRBreferral`, `BRBwaggered`, `BRBstaked`, `BRBpoints` tokens — schema
will add those then.

## 4. Rewrite mappings

- `src/mappings/brbToken.ts` — ERC-20 Transfer/Approval, update
  `User.brbBalance`, `ProtocolStats.brbTotalSupply`.
- `src/mappings/marketRegistry.ts` — handle `MarketCreated` →
  create `Market` entity and instantiate `BankVault4626` template;
  `VaultBeaconUpdated`, `EngineUpdated` write to a singleton
  `RegistryConfig`.
- `src/mappings/rouletteEngine.ts` — `BetRecorded`, `RoundLocked`,
  `GlobalRoundSealed`, `VrfRequested`, `VRFResult`, `RoundResolved`,
  `PayoutProgress`, `JackpotFunded`, `InfrastructureFeePaid`,
  `MinJackpotConditionUpdated`, withdrawal-queue admin events.
- `src/mappings/bankVault.ts` (template) — `BetPlaced`,
  `MinBetUpdated`, `BetsReleased`, `PayoutBatchProcessed`,
  `FundsTransferred`, `WithdrawalRequested`, `WithdrawalProcessed`,
  `WithdrawalEjected`, ERC-20 `Transfer` (share token), ERC-4626
  `Deposit` / `Withdraw`, role / upgrade events.
- `src/mappings/jackpotTreasury.ts` — `EngineSet`. (BRB inflow / outflow
  is observed via the `BRBToken` mapping.)
- `src/mappings/brbJackpotFunder.ts` — `SwapAssetBpsUpdated`,
  `TreasuryBrbSplitUpdated`, `SlippageBpsUpdated`, `BrbRatioUpdated`,
  `FundFromMarketSkipped`, `JackpotTreasuryTransferFailed`,
  `JackpotBurnFailed`, `FundedFromMarket`.
- `src/mappings/upkeepScheduler.ts` — config + cursor events.
- `src/mappings/upkeepManager.ts` — `UpkeepRegistered`.

Keep helpers (`aggregation`, `betting`, `globalState`, `user`,
`rouletteRound`, etc.) — adapt `betting.ts` to decode the new payload
`(uint256[] betTypes, uint256[] numbers, uint256[] amounts)`.

## 5. Tests

- Move `tests/*` → `tests/legacy/` (do not delete).
- Add new matchstick tests:
  - `tests/marketRegistry.test.ts` — `MarketCreated` instantiates a
    `Market` + template.
  - `tests/multiMarketBet.test.ts` — `BetRecorded` across two markets
    produces correct per-market totals.
  - `tests/jackpotFunding.test.ts` — `FundedFromMarket` updates
    `JackpotState`, `ProtocolStats.totalBurned`.
  - `tests/withdrawalQueue.test.ts` — `WithdrawalRequested` →
    `WithdrawalProcessed` reduces queue length; `WithdrawalEjected`
    reasons are surfaced.

## 6. Build / deploy

```bash
yarn install
yarn codegen
yarn build
yarn test                    # matchstick
yarn deploy:subgraph biribi
yarn prod:subgraph biribi    # tag :prod on Goldsky
```

## 7. Frontend coordination

Frontend (`biribinet/frontend`) reads from the subgraph via
`hooks/contracts/use*.ts`. After step 6 lands, prompt 2 must update
queries and types to match the new schema. Do not deploy the subgraph
to `:prod` until frontend is on a compatible branch.

## Backlog (for prompt 4 / prompt 2)

- BRBpoints / BRBreferral / BRBwaggered / BRBstaked tokens (prompt 4).
- Side-bet market entities (prompt 3).
- Solana bridge events on the Arbitrum side helper contract (prompt 5).
