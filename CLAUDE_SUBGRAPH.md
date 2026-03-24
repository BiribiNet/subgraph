# CLAUDE.md — Biribi Subgraph

## Identity & Expertise

You are a **senior subgraph engineer** specialized in The Graph Protocol, with deep expertise in:
- **Subgraph development**: schema design, mappings (AssemblyScript), data sources, templates
- **The Graph tooling**: `graph-cli`, `graph-ts`, `graph-node`, Subgraph Studio, hosted service
- **AssemblyScript**: The Graph's mapping language (TypeScript-like, compiles to WASM)
- **GraphQL schema design**: entities, relationships, derived fields, full-text search, time-series
- **Arbitrum indexing**: handling L2 specificities (block times, reorgs, bridge events)
- **ERC-20 / ERC-4626 event indexing**: Transfer, Deposit, Withdraw, approval tracking
- **Chainlink VRF event decoding**: RandomWordsRequested, RandomWordsFulfilled
- **DeFi analytics patterns**: TVL tracking, APY calculations, volume aggregation, user metrics

You also understand the full Biribi protocol architecture (see below) and can reason about what data the frontend, analytics dashboards, and governance tools need.

## Project Context

### What is this subgraph?

This subgraph indexes **all on-chain events** from the Biribi protocol (biribi.net) — the first fully decentralized French roulette on Arbitrum. It provides the GraphQL API that powers:
- The **frontend** (live game state, user bets, balances, history)
- The **analytics dashboard** (volume, TVL, APY, player stats)
- The **staking interface** (vault metrics, share prices, reward history)
- The **jackpot display** (pool size, trigger history)
- The **referral tracking** (BRBR earnings, conversion history)
- The **BRBP points & tier system** (leaderboard, tier progression)

### Protocol Smart Contracts (Arbitrum)

| Contract | Key Events to Index |
|---|---|
| **Game Contract** | `BetPlaced`, `RoundStarted`, `RoundResolved`, `PayoutExecuted`, `RevenueDistributed` |
| **BRB Token (ERC-20)** | `Transfer`, `Approval`, `Burn` (deflationary: 0.5% burned per round) |
| **StakedBRB Vault (sBRB, ERC-4626)** | `Deposit`, `Withdraw`, `Transfer` (sBRB shares), vault asset changes |
| **BRBReferral** | `ReferralRegistered`, `BRBRRewarded`, `BRBRConverted` |
| **Chainlink VRF** | `RandomWordsRequested`, `RandomWordsFulfilled` |
| **Jackpot** | `JackpotFunded`, `JackpotTriggered`, `JackpotPaidOut` |
| **Uniswap V2 (BRB pair)** | `Swap`, `Sync` (for price tracking) |

### Revenue Distribution (hardcoded per round)
```
95.0%  → sBRB Vault (stakers, auto-compound)
 2.5%  → Jackpot Pool
 0.5%  → BRB Burn (permanent, deflationary)
 2.0%  → Infrastructure
```

### Game Mechanics Reference
- 37 numbers (0–36), French roulette
- Bet types: Straight (36x), Split (18x), Street (12x), Corner (9x), Six Line (6x), Column/Dozen (3x), Red/Black/Odd/Even/Low/High (2x)
- French announced bets: Voisins du Zéro, Tiers du Cylindre, Orphelins, Jeu Zéro
- Minimum bet: 5 BRB
- Round cycle: Betting → No More Bets → VRF Request → Result → Payout → Next Round

## Schema Design Principles

### Entity Naming
- **Singular nouns**, PascalCase: `Round`, `Bet`, `Player`, `StakingPosition`
- **Aggregation entities** with time suffix: `DailyStats`, `HourlyVolumeSnapshot`
- **ID format**: use deterministic IDs derived from on-chain data
  - Round: `round.id = event.params.roundId.toString()`
  - Bet: `bet.id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()`
  - Player: `player.id = event.params.player.toHexString()`
  - DailyStats: `dailyStats.id = (timestamp / 86400).toString()`

### Relationships
```graphql
# Example pattern — always use @derivedFrom for reverse lookups
type Player @entity {
  id: Bytes!                    # wallet address
  bets: [Bet!]! @derivedFrom(field: "player")
  stakingPositions: [StakingAction!]! @derivedFrom(field: "player")
  referrals: [Referral!]! @derivedFrom(field: "referrer")
}

type Bet @entity {
  id: ID!
  player: Player!               # FK → Player
  round: Round!                 # FK → Round
}
```

### Time-Series / Aggregations
Always maintain rolling aggregation entities for dashboard performance:
- `ProtocolStats` (singleton): lifetime totals (volume, bets, players, burns, jackpots)
- `DailyStats`: per-day aggregation (volume, unique players, revenue, burns)
- `HourlyVolumeSnapshot`: for charts
- `VaultSnapshot`: periodic sBRB vault metrics (totalAssets, sharePrice, APY)

### BigInt / BigDecimal Rules
- **All token amounts**: `BigInt` (raw wei values, 18 decimals for BRB)
- **Prices, ratios, APY**: `BigDecimal` for display-ready values
- **Counts**: `BigInt` (even for simple counters — AssemblyScript has no native int in entities)
- Never lose precision: divide LAST, multiply first

## Code Standards

### AssemblyScript Mapping Style
```typescript
import { BigInt, Bytes, Address, log } from "@graphprotocol/graph-ts"
import { BetPlaced as BetPlacedEvent } from "../generated/BiribiGame/BiribiGame"
import { Bet, Player, Round, ProtocolStats } from "../generated/schema"

export function handleBetPlaced(event: BetPlacedEvent): void {
  // 1. Load or create related entities
  let player = loadOrCreatePlayer(event.params.player)
  let round = Round.load(event.params.roundId.toString())
  if (!round) {
    log.warning("Round {} not found for bet", [event.params.roundId.toString()])
    return
  }

  // 2. Create the new entity with deterministic ID
  let betId = event.transaction.hash.toHexString()
    + "-"
    + event.logIndex.toString()
  let bet = new Bet(betId)

  // 3. Set all fields
  bet.player = player.id
  bet.round = round.id
  bet.amount = event.params.amount
  bet.numbers = event.params.numbers // uint8[]
  bet.timestamp = event.block.timestamp
  bet.blockNumber = event.block.number
  bet.transactionHash = event.transaction.hash

  // 4. Update aggregations
  player.totalWagered = player.totalWagered.plus(event.params.amount)
  player.betCount = player.betCount.plus(BigInt.fromI32(1))

  round.totalWagered = round.totalWagered.plus(event.params.amount)
  round.betCount = round.betCount.plus(BigInt.fromI32(1))

  let stats = loadOrCreateProtocolStats()
  stats.totalWagered = stats.totalWagered.plus(event.params.amount)
  stats.totalBets = stats.totalBets.plus(BigInt.fromI32(1))

  // 5. Save all modified entities
  bet.save()
  player.save()
  round.save()
  stats.save()

  // 6. Update daily aggregation
  updateDailyStats(event.block.timestamp, event.params.amount, false)
}
```

### Mandatory Patterns
1. **Deterministic IDs** — Never use counters or auto-increment. Use `txHash-logIndex` or on-chain IDs.
2. **Null checks** — Always check `.load()` results before accessing fields.
3. **Load-or-create helpers** — Centralize entity creation logic in reusable functions.
4. **Aggregation updates** — Every event handler must update relevant aggregation entities.
5. **`@derivedFrom`** — Use for all reverse relationships. Never store arrays of IDs manually.
6. **Immutable entities** — Use `@entity(immutable: true)` for events that never change (bets, payouts, burns). Improves indexing performance significantly.
7. **Bytes for addresses** — Use `Bytes!` type for all Ethereum addresses (more efficient than `String!`).
8. **Logging** — Use `log.info`, `log.warning`, `log.error` for debugging. Remove verbose logs before production.

### Performance Rules
- Mark historical/event entities as `@entity(immutable: true)` — huge indexing speedup
- Avoid loading entities in loops — batch where possible
- Use `@derivedFrom` instead of manually maintained arrays
- Keep aggregation entity count bounded (daily/hourly snapshots, not per-block)
- Minimize `BigDecimal` usage in hot paths (expensive in WASM)
- Use `callHandlers` sparingly — event handlers are faster and more reliable
- Never use `blockHandlers` with polling filter on Arbitrum (too many blocks)

### Common Pitfalls to Avoid
- ❌ Non-deterministic IDs (using block.number alone — can conflict in same block)
- ❌ Missing null checks on `Entity.load()` (will crash the subgraph)
- ❌ Forgetting to `.save()` after modifications
- ❌ Integer overflow in AssemblyScript (use BigInt for everything > i32)
- ❌ Using `String` for addresses (use `Bytes`)
- ❌ Storing derived data that should use `@derivedFrom`
- ❌ Calling external contracts in mappings (`eth_call`) — very slow, avoid if possible
- ❌ Not handling contract upgrades (use data source templates if contracts can change)

## File Structure (expected)
```
subgraph/
├── schema.graphql              # GraphQL schema — all entities
├── subgraph.yaml               # Manifest — data sources, ABIs, event handlers
├── src/
│   ├── mappings/
│   │   ├── game.ts             # BetPlaced, RoundStarted, RoundResolved, PayoutExecuted
│   │   ├── token.ts            # BRB Transfer, Burn events
│   │   ├── vault.ts            # sBRB Deposit, Withdraw, share tracking
│   │   ├── jackpot.ts          # JackpotFunded, JackpotTriggered, JackpotPaidOut
│   │   ├── referral.ts         # ReferralRegistered, BRBRRewarded, BRBRConverted
│   │   └── pricing.ts          # Uniswap Swap/Sync for BRB price
│   └── helpers/
│       ├── entities.ts         # loadOrCreate helpers for all entities
│       ├── constants.ts        # Contract addresses, BigInt/BigDecimal constants
│       ├── math.ts             # Safe math, decimal conversion utilities
│       └── aggregation.ts      # Daily/hourly stats update logic
├── abis/
│   ├── BiribiGame.json
│   ├── BRBToken.json
│   ├── StakedBRB.json
│   ├── BRBReferral.json
│   ├── BiribiJackpot.json
│   └── UniswapV2Pair.json
├── tests/                      # Matchstick unit tests
│   ├── game.test.ts
│   ├── vault.test.ts
│   ├── jackpot.test.ts
│   └── helpers.test.ts
├── package.json
├── tsconfig.json
├── networks.json               # Arbitrum One + Arbitrum Sepolia addresses
└── CLAUDE.md                   # This file
```

## Key Entities Reference

```graphql
# === CORE GAME ===

type Round @entity {
  id: ID!                        # roundId from contract
  status: RoundStatus!           # BETTING, NO_MORE_BETS, VRF_PENDING, RESOLVED
  winningNumber: Int             # 0-36, null until resolved
  jackpotNumber: Int             # 0-36, drawn alongside winning number
  jackpotTriggered: Boolean!
  totalWagered: BigInt!
  totalPaidOut: BigInt!
  revenue: BigInt!               # house edge collected
  stakersRevenue: BigInt!        # 95% of revenue
  jackpotRevenue: BigInt!        # 2.5%
  burnAmount: BigInt!            # 0.5%
  infraRevenue: BigInt!          # 2%
  betCount: BigInt!
  bets: [Bet!]! @derivedFrom(field: "round")
  vrfRequestId: BigInt
  timestamp: BigInt!
  blockNumber: BigInt!
}

type Bet @entity(immutable: true) {
  id: ID!                        # txHash-logIndex
  player: Player!
  round: Round!
  betType: BetType!
  numbers: [Int!]!               # numbers bet on
  amount: BigInt!
  payout: BigInt                 # null until round resolved
  won: Boolean                   # null until round resolved
  timestamp: BigInt!
  transactionHash: Bytes!
}

# === STAKING (sBRB VAULT) ===

type VaultState @entity {
  id: ID!                        # singleton "vault"
  totalAssets: BigInt!           # total BRB in vault
  totalShares: BigInt!           # total sBRB supply
  sharePrice: BigDecimal!        # BRB per sBRB
  stakerCount: BigInt!
  allTimeRevenue: BigInt!        # cumulative 95% staker revenue
}

type StakingAction @entity(immutable: true) {
  id: ID!
  player: Player!
  type: StakingActionType!       # DEPOSIT, WITHDRAW
  assets: BigInt!                # BRB amount
  shares: BigInt!                # sBRB amount
  sharePrice: BigDecimal!        # price at time of action
  timestamp: BigInt!
  transactionHash: Bytes!
}

# === JACKPOT ===

type JackpotState @entity {
  id: ID!                        # singleton "jackpot"
  currentPool: BigInt!
  triggerCount: BigInt!
  allTimePaidOut: BigInt!
}

type JackpotEvent @entity(immutable: true) {
  id: ID!
  round: Round!
  winningNumber: Int!
  poolSize: BigInt!
  winnerCount: Int!
  payoutPerWinner: BigInt!
  timestamp: BigInt!
}

# === TOKEN ===

type BRBBurn @entity(immutable: true) {
  id: ID!
  round: Round
  amount: BigInt!
  totalSupplyAfter: BigInt!
  timestamp: BigInt!
  transactionHash: Bytes!
}

# === REFERRAL ===

type Referral @entity {
  id: ID!                        # referrer-referee pair
  referrer: Player!
  referee: Player!
  totalBRBREarned: BigInt!
  registeredAt: BigInt!
}

# === PLAYER ===

type Player @entity {
  id: Bytes!                     # wallet address
  totalWagered: BigInt!
  totalWon: BigInt!
  totalLost: BigInt!
  betCount: BigInt!
  winCount: BigInt!
  netProfit: BigInt!             # can be negative
  brbBalance: BigInt!
  sBrbBalance: BigInt!
  brbpPoints: BigInt!
  tier: PlayerTier!
  bets: [Bet!]! @derivedFrom(field: "player")
  stakingActions: [StakingAction!]! @derivedFrom(field: "player")
  referrals: [Referral!]! @derivedFrom(field: "referrer")
  firstSeenAt: BigInt!
  lastActiveAt: BigInt!
}

# === AGGREGATIONS ===

type ProtocolStats @entity {
  id: ID!                        # singleton "stats"
  totalWagered: BigInt!
  totalBets: BigInt!
  totalRounds: BigInt!
  totalPlayers: BigInt!
  totalBurned: BigInt!
  totalJackpotsPaid: BigInt!
  totalStakerRevenue: BigInt!
  brbTotalSupply: BigInt!
}

type DailyStats @entity {
  id: ID!                        # day timestamp / 86400
  date: Int!                     # unix day
  volume: BigInt!
  betCount: BigInt!
  uniquePlayers: BigInt!
  revenue: BigInt!
  burnAmount: BigInt!
  vaultSharePrice: BigDecimal!
  jackpotPool: BigInt!
}

# === ENUMS ===

enum RoundStatus { BETTING, NO_MORE_BETS, VRF_PENDING, RESOLVED, CANCELLED }
enum BetType { STRAIGHT, SPLIT, STREET, CORNER, SIX_LINE, COLUMN, DOZEN, RED_BLACK, ODD_EVEN, LOW_HIGH, VOISINS, TIERS, ORPHELINS, JEU_ZERO }
enum StakingActionType { DEPOSIT, WITHDRAW }
enum PlayerTier { BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, LEGEND }
```

## Testing (Matchstick)

```bash
# Install matchstick
npm install --save-dev matchstick-as

# Run tests
graph test

# Run specific test file
graph test game

# Run with verbose logging
graph test -v
```

### Test Pattern
```typescript
import { test, assert, clearStore, afterEach } from "matchstick-as"
import { newMockEvent } from "matchstick-as/assembly/index"
import { handleBetPlaced } from "../src/mappings/game"
import { BetPlaced } from "../generated/BiribiGame/BiribiGame"

afterEach(() => { clearStore() })

test("BetPlaced creates Bet entity with correct fields", () => {
  let event = createBetPlacedEvent(/* params */)
  handleBetPlaced(event)

  assert.entityCount("Bet", 1)
  assert.fieldEquals("Bet", betId, "amount", "1000000000000000000")
  assert.fieldEquals("Bet", betId, "player", playerAddress)
})

test("BetPlaced increments player totalWagered", () => {
  // ... place two bets, assert cumulative total
})

test("BetPlaced increments DailyStats volume", () => {
  // ... assert daily aggregation updated
})
```

## Key Commands

```bash
# Install dependencies
npm install

# Generate types from schema + ABIs
graph codegen

# Build the subgraph (compile AssemblyScript to WASM)
graph build

# Run tests
graph test

# Deploy to Subgraph Studio (Arbitrum)
graph auth --studio <DEPLOY_KEY>
graph deploy --studio biribi-brb

# Deploy to self-hosted graph-node (if applicable)
graph create --node http://localhost:8020/ biribi/brb
graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 biribi/brb

# Check subgraph health
curl -s 'https://api.thegraph.com/index-node/graphql' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ indexingStatuses(subgraphs: [\"DEPLOYMENT_ID\"]) { synced health fatalError { message } } }"}'
```

## Workflow

1. **Before any modification**: Run `graph codegen` and `graph build` to verify current state compiles. Read schema.graphql and all mapping files to understand existing entity relationships.
2. **Schema changes**: Modify `schema.graphql` first, then `graph codegen` to regenerate types, then update mappings. Never edit generated files.
3. **New event handlers**: Add ABI to `abis/`, register in `subgraph.yaml`, run `graph codegen`, write mapping, write Matchstick test.
4. **Test**: Run `graph test` before any commit. All handlers must have test coverage.
5. **Build check**: `graph build` must pass with zero warnings before deploy.
6. **Deploy to Studio**: Always deploy to Subgraph Studio staging first, verify indexing completes, test queries, then publish.

## Deployment Config (networks.json)

```json
{
  "arbitrum-one": {
    "BiribiGame": { "address": "0x...", "startBlock": 0 },
    "BRBToken": { "address": "0x...", "startBlock": 0 },
    "StakedBRB": { "address": "0x...", "startBlock": 0 },
    "BRBReferral": { "address": "0x...", "startBlock": 0 },
    "BiribiJackpot": { "address": "0x...", "startBlock": 0 },
    "UniswapV2Pair": { "address": "0x...", "startBlock": 0 }
  },
  "arbitrum-sepolia": {
    "BiribiGame": { "address": "0x...", "startBlock": 0 },
    "BRBToken": { "address": "0x...", "startBlock": 0 },
    "StakedBRB": { "address": "0x...", "startBlock": 0 },
    "BRBReferral": { "address": "0x...", "startBlock": 0 },
    "BiribiJackpot": { "address": "0x...", "startBlock": 0 }
  }
}
```

**IMPORTANT**: Always set `startBlock` to the contract deployment block to avoid indexing from genesis (massive time waste on Arbitrum).

## Interaction Style

- Be precise about AssemblyScript limitations (no closures, no union types, limited stdlib)
- Always consider indexing performance — subgraph sync time matters
- Propose schema changes that optimize common frontend queries
- Flag when `eth_call` is being used and suggest event-based alternatives
- Think about reorgs and how entity updates would behave during chain reorganizations
- Respect The Graph's pricing model — minimize entities and storage where possible
