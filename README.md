# Biribi Subgraph

Indexes all on-chain events from the Biribi protocol — the first fully decentralized French roulette on Arbitrum. Provides the GraphQL API powering the frontend, analytics dashboard, staking interface, and jackpot display.

## Data Sources

| Contract | Key Events |
|----------|-----------|
| **BRB Token (ERC-20)** | `Transfer` (balances, burns, payouts, jackpot funding) |
| **RouletteClean** | `VrfRequested`, `VRFResult`, `RoundResolved`, `BatchProcessed`, `ComputedPayouts`, `JackpotResultEvent` |
| **StakedBRB (ERC-4626)** | `Deposit`, `Withdraw`, `BetPlaced`, `RoundCleaningCompleted`, `Transfer` (sBRB shares) |
| **BRBReferal** | `Transfer` (referral token balances) |

## Key Entities

### User
Player/staker profile with balances and analytics.
- `brbBalance`, `sbrbBalance`, `brbReferalBalance` — live token balances
- `totalStaked`, `totalUnstaked` — cumulative staking stats
- `totalRouletteBets`, `totalRouletteWins`, `netProfit`, `winCount` — roulette P&L
- `firstSeenAt`, `lastActiveAt` — activity timestamps
- `cumulativeDepositValue`, `cumulativeDepositShares` — cost basis tracking

### GlobalState (singleton)
Protocol-wide metrics.
- `totalAssets`, `totalShares`, `sharePrice` — vault state
- `apy7Day`, `apy30Day`, `apy365Day`, `apyLifetime` — rolling APYs
- `totalRounds`, `uniquePlayersCount`, `stakersCount` — counters
- `totalBurned`, `currentJackpot`, `totalStakerRevenue` — protocol stats
- `maxBetAmount`, `pendingBets` — game state

### RouletteRound
Round lifecycle from betting to cleanup.
- Status: `BETTING` → `VRF` → `COMPUTING_PAYOUT` → `PAYOUT` → `CLEAN`
- `winningNumber`, `jackpotNumber` — VRF results
- `totalBets`, `totalPayouts` — round volume
- `stakersRevenue`, `infraRevenue`, `roundBurnAmount`, `jackpotRevenue` — revenue split

### RouletteBet
Per-user per-round bet aggregation.
- `amounts[]`, `betTypes[]`, `numbers[]` — individual bet details
- `totalAmount` — sum of all bets in this round
- `actualPayout` — payout received (null until resolved)
- `won` — whether the bet won (null until resolved)

### Aggregations
- **DailyStats** — daily volume, betCount, uniquePlayers, revenue, burns, jackpot
- **HourlyVolumeSnapshot** — hourly volume, betCount, uniquePlayers
- **APYSnapshot** — daily vault snapshots for APY calculation

## Bet Types

STRAIGHT, SPLIT, STREET, CORNER, LINE, COLUMN, DOZEN, RED, BLACK, ODD, EVEN, LOW, HIGH, TRIO_012, TRIO_023

## Usage Examples

### Query User Stats
```graphql
query GetUserStats($address: Bytes!) {
  user(id: $address) {
    brbBalance
    sbrbBalance
    totalRouletteBets
    totalRouletteWins
    netProfit
    winCount
    firstSeenAt
    lastActiveAt
    rouletteBets(first: 10, orderBy: latestBetTimestamp, orderDirection: desc) {
      totalAmount
      betTypes
      won
      actualPayout
      firstBetTimestamp
      latestBetTimestamp
    }
  }
}
```

### Query Round Info
```graphql
query GetRoundInfo($roundId: Bytes!) {
  rouletteRound(id: $roundId) {
    roundNumber
    status
    winningNumber
    jackpotNumber
    totalBets
    totalPayouts
    stakersRevenue
    startedAt
    endedAt
    bets(first: 10) {
      user { id }
      totalAmount
      betTypes
      won
      actualPayout
    }
  }
}
```

### Query Protocol Stats
```graphql
query GetProtocolStats {
  globalState(id: "0x0000000000000000000000000000000000000001") {
    totalAssets
    totalShares
    sharePrice
    apy7Day
    apy30Day
    apyLifetime
    totalRounds
    uniquePlayersCount
    stakersCount
    totalBurned
    currentJackpot
    totalStakerRevenue
    maxBetAmount
  }
}
```

### Query Daily Analytics
```graphql
query GetDailyStats($dayId: ID!) {
  dailyStats(id: $dayId) {
    volume
    betCount
    uniquePlayers
    revenue
    burnAmount
    jackpotFunded
    vaultSharePrice
    roundsCompleted
    totalPayouts
  }
}
```

## Development

```bash
yarn install          # Install dependencies
yarn codegen          # Generate types from schema + ABIs
yarn build            # Compile to WASM
yarn test             # Run Matchstick tests
```

## Deployment

```bash
yarn deploy:subgraph <version>   # Deploy to Goldsky
yarn prod:subgraph <version>     # Tag as production
yarn deploy <version>            # Codegen + build + deploy + tag
```

## Revenue Distribution Per Round

```
95.0%  → sBRB Vault (stakers, auto-compound)
 2.5%  → Jackpot Pool
 0.5%  → BRB Burn (permanent, deflationary)
 2.0%  → Infrastructure
```
