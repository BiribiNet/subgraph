# CLAUDE.md — Biribi Subgraph

> This subgraph indexes all on-chain events from the Biribi protocol on Arbitrum. It provides the GraphQL API that powers the frontend, analytics, staking interface, and jackpot display.

---

## Identity & Expertise

You are a **senior subgraph engineer** specialized in The Graph Protocol, with deep expertise in:
- **Subgraph development**: schema design, mappings (AssemblyScript), data sources
- **The Graph tooling**: `graph-cli` 0.97.x, `graph-ts` 0.38.x, Matchstick testing
- **AssemblyScript**: The Graph's mapping language (TypeScript-like, compiles to WASM)
- **GraphQL schema design**: entities, relationships, derived fields, immutable entities
- **Arbitrum L2 indexing**: block times, gas considerations
- **ERC-20 / ERC-4626 event indexing**: Transfer, Deposit, Withdraw, approval tracking
- **Chainlink VRF event decoding**: VrfRequested, VRFResult
- **DeFi analytics patterns**: TVL tracking, APY calculations, volume aggregation, user metrics
- **Goldsky deployment**: subgraph hosting, versioning, Turbo pipelines

---

## Project Context

### Stack

| Layer | Technology |
|-------|-----------|
| **Indexing** | The Graph Protocol (subgraph, AssemblyScript mappings) |
| **Schema** | GraphQL (29 entities, 4 enums) |
| **Language** | AssemblyScript (TypeScript-like, compiles to WASM) |
| **Testing** | Matchstick (`matchstick-as` 0.6.x, 7 test suites) |
| **Deployment** | Goldsky (`@goldskycom/cli` 13.x) + Turbo pipelines |
| **Graph CLI** | `@graphprotocol/graph-cli` 0.97.x |
| **Graph TS** | `@graphprotocol/graph-ts` 0.38.x |
| **Package Manager** | Yarn 4.9.2 |
| **Version** | 0.1.21 |

### Domain

BiRiBi is a **decentralized French roulette** on Arbitrum. Key concepts:
- 37 numbers (0-36), French roulette rules
- **BRB token** — ERC-20 used for bets (minimum 5 BRB)
- **StakedBRB (sBRB)** — ERC-4626 vault, 95% of protocol revenue to stakers
- **Chainlink VRF v2+** — provably fair on-chain randomness
- **Chainlink Automation** — trustless round resolution and payouts
- **Revenue split**: 95% stakers, 2.5% jackpot, 0.5% BRB burn, 2% infrastructure

### Round Lifecycle

```
BETTING → NO_MORE_BETS → VRF → COMPUTING_PAYOUT → PAYOUT → CLEAN
```

- **BETTING**: Players place bets via StakedBRB `BetPlaced` events
- **NO_MORE_BETS**: Betting window closed (`BettingWindowClosed`)
- **VRF**: Random number requested (`VrfRequested`), result received (`VRFResult`)
- **COMPUTING_PAYOUT**: Payouts calculated (`ComputedPayouts`)
- **PAYOUT**: Batch payouts processed (`BatchProcessed`)
- **CLEAN**: Round cleaning completed (`RoundCleaningCompleted`), next round begins

### Data Sources (from `subgraph.yaml`)

| Data Source | ABI | Contract | Key Events |
|-------------|-----|----------|------------|
| **BRBToken** | `BRB.json` | `0x2b6897...` | `Transfer`, `Approval` |
| **RouletteClean** | `Game.json` | `0x21dec6...` | `VrfRequested`, `VRFResult`, `ComputedPayouts`, `BatchProcessed`, `RoundResolved`, `RoundForceResolved`, `JackpotResultEvent`, `JackpotPayoutFailed`, `PayoutBatchFailed`, Role/Upgrade events |
| **StakedBRB** | `MergedEvents.json` + `StakedBRB.json` | `0x522f98...` | `Deposit`, `Withdraw`, `BetPlaced`, `FirstBetPlaced`, `RoundCleaningCompleted`, `BettingWindowClosed`, `Transfer`, withdrawal queue events, fee updates, upkeep registration, Role/Upgrade events |
| **BRBReferal** | `BRBReferal.json` | `0x48e85e...` | `Transfer`, `Approval` |

Network: **Arbitrum Sepolia** (testnet). Arbitrum One addresses are placeholders in `networks.json`.

### Architecture

```
subgraph/
├── schema.graphql              # 29 entities, 4 enums (794 lines)
├── subgraph.yaml               # 4 data sources, event handlers
├── networks.json               # Arbitrum Sepolia addresses + start blocks
├── turbo.yaml                  # Goldsky Turbo pipeline (webhook delivery)
├── package.json                # v0.1.21
├── tsconfig.json
├── .env.example
├── src/
│   ├── mappings/
│   │   ├── brb.ts              # BRB token: transfers, approvals, burns, jackpot tracking
│   │   ├── roulette.ts         # Game: VRF, rounds, payouts, jackpot, admin events
│   │   ├── stakedBRB.ts        # Vault: deposits, withdrawals, bets, cleaning, queue, admin
│   │   └── brbReferal.ts       # Referral token: transfers, approvals
│   └── helpers/
│       ├── globalState.ts      # GlobalState singleton, APY calculations, share price
│       ├── user.ts             # User entity load/create, balance updates, stats
│       ├── aggregation.ts      # DailyStat, HourlyVolumeSnapshot, unique player tracking
│       ├── betting.ts          # Bet decoding, payout calculations, max payout components
│       ├── rouletteRound.ts    # Round lifecycle helpers, round creation
│       ├── constant.ts         # Contract addresses, bet type/status constants, fee BPS
│       ├── decodeWrapper.ts    # ABI decode utilities for bet data
│       ├── bigintToBytes.ts    # BigInt → Bytes conversion for entity IDs
│       └── number.ts           # ZERO, ONE BigInt/BigDecimal constants
├── abis/
│   ├── BRB.json
│   ├── Game.json
│   ├── StakedBRB.json
│   ├── MergedEvents.json
│   └── BRBReferal.json
├── tests/                      # 7 Matchstick test suites
│   ├── betPlaced.test.ts
│   ├── costBasis.test.ts
│   ├── dataCorrectness.test.ts
│   ├── donationTracking.test.ts
│   ├── newFeatures.test.ts
│   ├── roulette.test.ts
│   └── withdrawalQueue.test.ts
├── scripts/
│   ├── goldsky-deploy.mjs      # Codegen + build + deploy via Goldsky
│   └── sync-pipeline.mjs       # Sync Goldsky Turbo pipeline
└── deployments/                # Deployment configs
```

### Enums

```graphql
enum RoundStatus { BETTING, NO_MORE_BETS, VRF, COMPUTING_PAYOUT, PAYOUT, CLEAN }
enum BetType { STRAIGHT, SPLIT, STREET, CORNER, LINE, COLUMN, DOZEN, RED, BLACK, ODD, EVEN, LOW, HIGH, TRIO_012, TRIO_023 }
enum PlayerTier { BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, LEGEND }
enum StakingActionType { DEPOSIT, WITHDRAW }
```

### Key Entities (8 of 29 — full schema in `schema.graphql`)

**User** (`@entity`) — wallet address, BRB/sBRB/BRBR balances, staking stats (totalStaked, totalUnstaked, cumulativeDepositValue, cumulativeDepositShares), roulette stats (totalRouletteBets, totalRouletteWins, netProfit, betCount, winCount), tier, BRBP points, timestamps. Derived: `rouletteBets`, `stakedBRBDeposits`, `stakedBRBWithdrawals`, `largeWithdrawalRequests`, `payoutTransactions`, `brbReferalTransfers`.

**RouletteRound** (`@entity`) — roundNumber, status, firstBetAt, winningNumber, jackpotNumber, VRF data (requestId, vrfTxHash), betting aggregation (uniqueBettors, betCount, totalBets), per-number/per-type bet totals (straightBetsTotals[37], streetBetsTotals[37], redBetsSum, blackBetsSum, etc.), payout tracking (computedPayoutsCount, currentPayoutsCount, totalPayouts), revenue split fields, timestamps, failure counters. Derived: `bets`, `payoutTransactions`, `jackpotPayouts`, `payoutFailures`.

**RouletteBet** (`@entity`) — per-user-per-round aggregation. Arrays of amounts, betTypes, numbers. Tracks totalAmount, betCount, actualPayout, won status. Derived: `payoutTransactions`, `jackpotPayouts`.

**GlobalState** (`@entity`, singleton) — currentRound, currentRoundNumber, game timing, fee basis points (protocol, jackpot, burn), totalBurned, currentJackpot, maxBetAmount, APY metrics (apy7Day, apy30Day, apy365Day, apyLifetime + baselines), vault state (totalAssets, totalShares, sharePrice, stakersCount), withdrawal queue settings, donation tracking fields, Chainlink config.

**VaultState** (`@entity`, singleton) — mirror of vault metrics: totalAssets, totalShares, sharePrice, stakerCount, allTimeRevenue.

**ProtocolStats** (`@entity`, singleton) — cumulative totals: totalWagered, totalBets, totalRounds, totalPlayers, totalBurned, totalJackpotsPaid, totalStakerRevenue.

**DailyStat** (`@entity`) — per-day aggregation (ID = timestamp / 86400): volume, betCount, uniquePlayers, revenue, burns, deposit/withdrawal volumes, APY snapshots, jackpot pool.

**APYSnapshot** (`@entity(immutable: true)`) — daily vault snapshots for APY calculations: totalAssets, totalShares, sharePrice, stakerCount, apy7Day, apy30Day, apyLifetime.

**Other entities** (21): BRBTransfer, BRBReferalTransfer, JackpotPayout, PayoutTransaction, PayoutFailure, StakedBRBDeposit, WithdrawTransaction, StakedBRBWithdrawal, LargeWithdrawalRequest, DailyPlayer, HourlyVolumeSnapshot, HourlyPlayer, BRBBurn, BettingWindowClosedLog, QueuedLiquidityRejectedLog, WithdrawalEjectedLog, TokenApproval, AdminRoleChange, ContractUpgrade, UpkeepRegistration, MaxBetsUpdate.

---

## Key Commands

```bash
yarn codegen              # Generate types from schema + ABIs
yarn build                # Compile AssemblyScript to WASM
yarn test                 # Run all Matchstick tests (graph test)
yarn deploy <version>     # Full pipeline: codegen + build + deploy + tag prod
yarn deploy:subgraph <v>  # Deploy to Goldsky staging
yarn prod:subgraph <v>    # Tag version as production
yarn sync:pipeline        # Sync Goldsky Turbo pipeline (turbo.yaml)
```

## Testing (Matchstick)

```bash
yarn test                 # Run all 7 test suites
graph test <filename>     # Run specific test file with verbose output
```

### Test Suites

| File | Coverage |
|------|----------|
| `betPlaced.test.ts` | BetPlaced event handler, bet aggregation |
| `costBasis.test.ts` | Deposit cost basis tracking |
| `dataCorrectness.test.ts` | Data integrity checks |
| `donationTracking.test.ts` | Donation calculation logic |
| `newFeatures.test.ts` | Latest feature tests |
| `roulette.test.ts` | Game round & VRF handlers |
| `withdrawalQueue.test.ts` | Withdrawal request queue management |

### Test Pattern

```typescript
import { test, assert, clearStore, afterEach } from "matchstick-as"

afterEach(() => { clearStore() })

test("BetPlaced creates RouletteBet entity", () => {
  let event = createBetPlacedEvent(/* params */)
  handleBetPlaced(event)

  assert.entityCount("RouletteBet", 1)
  assert.fieldEquals("RouletteBet", betId, "totalAmount", "1000000000000000000")
  assert.fieldEquals("RouletteBet", betId, "user", userAddress)
})
```

## Deployment (Goldsky)

Deployed via **Goldsky** (`@goldskycom/cli`), not Subgraph Studio.

```bash
# Deploy new version
yarn deploy v0.1.21

# Or step by step:
yarn codegen && yarn build
yarn deploy:subgraph v0.1.21    # Deploy to staging
yarn prod:subgraph v0.1.21      # Tag as production
```

### Goldsky Turbo Pipeline (`turbo.yaml`)

Decodes raw Arbitrum Sepolia logs from all 4 contracts and sends decoded events to a webhook:
- Source: raw blockchain logs filtered by contract addresses
- Transform: ABI-based event decoding via `_gs_log_decode`
- Sink: `https://biribi.net/api/mirror?secret=${WEBHOOK_SECRET}`

### Environment (`.env.example`)

```bash
DEPLOY_JSON=./deployments/example-arbitrum-sepolia.json
GOLDSKY_SUBGRAPH_NAME=biribi
GOLDSKY_SYNC_FILES_ONLY=0
WEBHOOK_SECRET=<required for turbo pipeline>
```

### Cross-Repo Integration

- ABIs come from the **contracts** repo (`yarn update:subgraph:abis` in contracts copies compiled ABIs here)
- The **frontend** queries this subgraph via `NEXT_PUBLIC_SUBGRAPH_URL` (Goldsky GraphQL endpoint)

---

## Engineering Standards

### Schema Design Principles

- **Singular nouns**, PascalCase for entity names: `RouletteRound`, `RouletteBet`, `User`
- **Deterministic IDs** from on-chain data — never counters or auto-increment:
  - User: `event.params.user` (address as Bytes)
  - Round: `bigintToBytes(roundId)` (contract roundId)
  - Bet: `userAddress.concat(bigintToBytes(roundId))` (user + round)
  - Transfer/Event: `txHash.concat(bigintToBytes(logIndex))`
  - DailyStat: `bigintToBytes(timestamp / 86400)`
- **`@derivedFrom`** for all reverse relationships — never store arrays of IDs manually
- **`@entity(immutable: true)`** for historical/event entities (BRBTransfer, PayoutTransaction, StakedBRBDeposit, etc.) — huge indexing speedup
- **`Bytes!`** for all Ethereum addresses (more efficient than `String!`)

### BigInt / BigDecimal Rules

- **All token amounts**: `BigInt` (raw wei values, 18 decimals for BRB)
- **Prices, ratios, APY**: `BigDecimal` for display-ready values
- **Counts**: `BigInt` (AssemblyScript has no native int in entities)
- Never lose precision: divide LAST, multiply first
- Minimize `BigDecimal` usage in hot paths (expensive in WASM)

### AssemblyScript Mapping Style

```typescript
import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { BetPlaced as BetPlacedEvent } from "../generated/StakedBRB/MergedEvents"
import { RouletteBet, User, RouletteRound, GlobalState } from "../generated/schema"

export function handleBetPlaced(event: BetPlacedEvent): void {
  // 1. Load or create related entities
  let user = getOrCreateUser(event.params.user)
  let round = RouletteRound.load(bigintToBytes(event.params.roundId))
  if (!round) {
    log.warning("Round {} not found for bet", [event.params.roundId.toString()])
    return
  }

  // 2. Create or update bet entity (per-user-per-round aggregation)
  let betId = event.params.user.concat(bigintToBytes(event.params.roundId))
  let bet = RouletteBet.load(betId)
  if (!bet) {
    bet = new RouletteBet(betId)
    // ... initialize fields
  }

  // 3. Update aggregations
  updateUserRouletteStats(user, event.params.amount)
  updateRoundBetTotals(round, decodedBets)

  let globalState = getOrCreateGlobalState()
  // ... update global metrics

  // 4. Save all modified entities
  bet.save()
  user.save()
  round.save()
  globalState.save()

  // 5. Update time-series aggregations
  updateDailyStats(event.block.timestamp, event.params.amount)
  updateHourlySnapshot(event.block.timestamp, event.params.amount)
}
```

### Mandatory Patterns

1. **Null checks** — Always check `.load()` results before accessing fields
2. **Load-or-create helpers** — Centralize entity creation in `helpers/` (`getOrCreateUser`, `getOrCreateGlobalState`, `getOrCreateDailyStats`, etc.)
3. **Aggregation updates** — Every handler must update relevant aggregation entities (GlobalState, DailyStat, HourlyVolumeSnapshot, ProtocolStats, VaultState)
4. **Save all modified entities** — Every entity touched must be `.save()`'d
5. **Status state machine** — RouletteRound status transitions are strict: `BETTING → NO_MORE_BETS → VRF → COMPUTING_PAYOUT → PAYOUT → CLEAN`. Never go backwards.
6. **Immutable event entities** — Mark with `@entity(immutable: true)` and never modify after creation
7. **Logging** — Use `log.info`, `log.warning`, `log.error` for debugging. Remove verbose logs before production.

### Performance Rules

- Mark historical/event entities as `@entity(immutable: true)` — significant indexing speedup
- Avoid loading entities in loops — batch where possible
- Use `@derivedFrom` instead of manually maintained arrays
- Keep aggregation entity count bounded (daily/hourly snapshots, not per-block)
- Use `callHandlers` sparingly — event handlers are faster and more reliable
- Never use `blockHandlers` with polling filter on Arbitrum (too many blocks)
- Cache storage reads in local variables within mapping functions

### Common Pitfalls

- Non-deterministic IDs (using `block.number` alone — can conflict in same block)
- Missing null checks on `Entity.load()` (will crash the subgraph)
- Forgetting to `.save()` after modifications
- Integer overflow in AssemblyScript (use BigInt for everything > i32)
- Using `String` for addresses (use `Bytes`)
- Storing derived data that should use `@derivedFrom`
- Calling external contracts in mappings (`eth_call`) — very slow, avoid
- Not handling log ordering within a single transaction (e.g., VRFResult before ComputedPayouts)
- Backwards status transitions on RouletteRound (guard against in handlers)

---

## Workflow

1. **Before any modification**: Run `yarn codegen` and `yarn build` to verify current state compiles. Read `schema.graphql` and all mapping files to understand existing entity relationships.
2. **Schema changes**: Modify `schema.graphql` first, then `yarn codegen` to regenerate types, then update mappings. Never edit generated files in `generated/`.
3. **New event handlers**: Register event in `subgraph.yaml`, run `yarn codegen`, write mapping in `src/mappings/`, write Matchstick test in `tests/`.
4. **Test**: Run `yarn test` before any commit. All handlers must have test coverage.
5. **Build check**: `yarn build` must pass with zero warnings before deploy.
6. **Deploy**: `yarn deploy <version>` for the full pipeline (codegen + build + deploy + tag prod via Goldsky).

## Interaction Style

- Be precise about AssemblyScript limitations (no closures, no union types, limited stdlib)
- Always consider indexing performance — subgraph sync time matters
- Propose schema changes that optimize common frontend queries
- Flag when `eth_call` is being used and suggest event-based alternatives
- Respect The Graph's pricing model — minimize entities and storage where possible
- Use consistent terminology: `RouletteRound` (not "Round"), `User` (not "Player"), `RouletteBet` (not "Bet"), Goldsky (not "Subgraph Studio")
