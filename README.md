# BRB Ecosystem Subgraph

This subgraph indexes the BRB (BiRiBi) token ecosystem, including the BRB token, RouletteClean contract, and StakedBRB vault contract.

## Overview

The BRB ecosystem consists of three main components:

1. **BRB Token** - The native ERC20 token with ERC677 functionality for betting
2. **RouletteClean** - A decentralized roulette game contract with VRF-based randomness
3. **StakedBRB** - An ERC4626 vault that allows users to stake BRB tokens and earn from betting losses

## Schema Entities

### Core Entities

#### User
- **id**: User address
- **brbBalance**: Current BRB token balance
- **totalStaked**: Total amount of BRB staked
- **totalUnstaked**: Total amount of BRB unstaked
- **totalRouletteBets**: Total amount bet in roulette games
- **totalRouletteWins**: Total amount won from roulette games
- **rouletteBets**: Array of roulette bets made by user
- **stakedBRBDeposits**: Array of deposits to StakedBRB vault
- **stakedBRBWithdrawals**: Array of withdrawals from StakedBRB vault
- **largeWithdrawalRequests**: Array of large withdrawal requests

#### BRBToken
- **id**: Contract address
- **totalSupply**: Total supply of BRB tokens
- **name**: Token name ("BiRiBi")
- **symbol**: Token symbol ("BRB")
- **decimals**: Token decimals (18)
- **transfers**: Array of all token transfers

#### RouletteClean
- **id**: Contract address
- **currentRound**: Current active round ID
- **lastRoundStartTime**: Timestamp of last round start
- **lastRoundPaid**: Last round that was fully processed
- **gamePeriod**: Game period in seconds
- **totalBets**: Total amount bet across all rounds
- **totalPayouts**: Total amount paid out across all rounds
- **rounds**: Array of all roulette rounds
- **bets**: Array of all roulette bets

#### StakedBRB
- **id**: Contract address
- **brbToken**: BRB token contract address
- **rouletteContract**: RouletteClean contract address
- **protocolFeeBasisPoints**: Protocol fee rate in basis points
- **feeRecipient**: Address that receives protocol fees
- **totalAssets**: Total assets under management
- **totalShares**: Total shares issued
- **pendingBets**: Amount locked in unresolved bets
- **currentRound**: Current active round
- **lastRoundResolved**: Last round that was resolved
- **lastRoundPaid**: Last round that was fully paid
- **roundTransitionInProgress**: Whether round transition is in progress
- **largeWithdrawalBatchSize**: Number of large withdrawals processed per batch
- **maxQueueLength**: Maximum queue length for large withdrawals
- **totalPendingLargeWithdrawals**: Total amount of pending large withdrawals

### Round Status Tracking

Roulette rounds have four distinct statuses:

1. **BETTING** - Round is active and accepting bets
2. **VRF** - Round has ended, VRF request submitted
3. **PAYOUT** - VRF result received, payouts being processed
4. **CLEAN** - Round fully resolved, protocol fees collected

### Bet Types

The subgraph supports all European roulette bet types:

- **STRAIGHT** - Single number (0-36)
- **SPLIT** - Two adjacent numbers
- **STREET** - Three numbers in a row
- **CORNER** - Four numbers in a square
- **LINE** - Six numbers (two streets)
- **COLUMN** - Column bet (12 numbers)
- **DOZEN** - Dozen bet (12 numbers)
- **RED** - Red numbers
- **BLACK** - Black numbers
- **ODD** - Odd numbers
- **EVEN** - Even numbers
- **LOW** - Low numbers (1-18)
- **HIGH** - High numbers (19-36)
- **TRIO_012** - Trio 0-1-2
- **TRIO_023** - Trio 0-2-3

## Key Features

### Round Lifecycle Tracking
- Complete round lifecycle from betting to cleanup
- Status transitions: BETTING → VRF → PAYOUT → CLEAN
- Timestamp tracking for each phase

### User Statistics
- Comprehensive user statistics including:
  - BRB token balance
  - Total staked/unstaked amounts
  - Roulette betting activity
  - Win/loss tracking

### Protocol Fee Tracking
- Protocol fees collected from betting losses
- Fee recipient tracking
- Round-based fee collection

### Large Withdrawal Management
- Queue-based large withdrawal system
- Batch processing of withdrawals
- Anti-spam protection

## Event Handlers

### BRB Token Events
- `Transfer` - Tracks all token transfers and updates user balances

### RouletteClean Events
- `BetPlaced` - Records individual bets and updates round totals
- `RoundStarted` - Initiates new round and transitions previous round to VRF
- `VRFResult` - Updates round with winning number and transitions to PAYOUT
- `RoundResolved` - Marks round as fully resolved (CLEAN status)
- `BatchProcessed` - Tracks payout batch processing

### StakedBRB Events
- `Deposit` - Records deposits to the vault
- `Withdraw` - Records withdrawals from the vault
- `LargeWithdrawalRequested` - Records large withdrawal requests
- `LargeWithdrawalProcessed` - Records processed large withdrawals
- `ProtocolFeeCollected` - Records protocol fee collection
- `RoundTransition` - Tracks round transitions
- `BetPlaced` - Records bets placed through the vault

## Usage Examples

### Query User Statistics
```graphql
query GetUserStats($userAddress: Bytes!) {
  user(id: $userAddress) {
    brbBalance
    totalStaked
    totalUnstaked
    totalRouletteBets
    totalRouletteWins
    rouletteBets(first: 10, orderBy: timestamp, orderDirection: desc) {
      amount
      betType
      isWinning
      actualPayout
      timestamp
    }
  }
}
```

### Query Round Information
```graphql
query GetRoundInfo($roundId: BigInt!) {
  rouletteRounds(where: { roundNumber: $roundId }) {
    roundNumber
    status
    winningNumber
    totalBets
    totalPayouts
    startedAt
    endedAt
    bets(first: 10) {
      user
      amount
      betType
      isWinning
    }
  }
}
```

### Query Vault Statistics
```graphql
query GetVaultStats {
  stakedBRBs {
    totalAssets
    totalShares
    pendingBets
    currentRound
    protocolFeeBasisPoints
    totalPendingLargeWithdrawals
  }
}
```

## Configuration

Before deploying, update the following in `subgraph.yaml`:

1. Replace placeholder addresses with actual contract addresses
2. Update start blocks to the deployment blocks
3. Ensure ABI files are correctly referenced

## Deployment

1. Install dependencies: `npm install`
2. Generate code: `npm run codegen`
3. Build: `npm run build`
4. Deploy: `npm run deploy`

## Notes

- The subgraph tracks the complete lifecycle of roulette rounds
- User statistics are automatically aggregated across all activities
- Large withdrawals are processed in batches to prevent gas issues
- Protocol fees are collected from betting losses and distributed to fee recipients
