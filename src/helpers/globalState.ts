import { Bytes, BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { GlobalState, APYSnapshot } from "../../generated/schema"
import { ZERO } from "./number"
import { bigintToBytes } from "./bigintToBytes"

const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001") // Singleton ID for global state

export function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    globalState.currentRound = bigintToBytes(BigInt.fromI32(1))
    globalState.currentRoundNumber = BigInt.fromI32(1)
    globalState.lastRoundStartTime = ZERO
    globalState.lastRoundPaid = ZERO
    globalState.gamePeriod = BigInt.fromI32(80) // Default 80 seconds
    globalState.totalPayouts = ZERO
    globalState.totalBurned = ZERO
    globalState.currentJackpot = ZERO
    globalState.maxBetAmount = ZERO
    globalState.apy7Day = BigDecimal.fromString("0")
    globalState.apy30Day = BigDecimal.fromString("0")
    globalState.apy365Day = BigDecimal.fromString("0")
    globalState.apyLifetime = BigDecimal.fromString("0")
    globalState.apyLifetimeBaselineTimestamp = ZERO
    globalState.apyLifetimeBaselineTotalAssets = ZERO
    globalState.apyLifetimeBaselineTotalShares = ZERO
    globalState.lastApySnapshotTimestamp = ZERO
    globalState.protocolFeeBasisPoints = BigInt.fromI32(200) // Default 2%
    globalState.jackpotFeeBasisPoints = BigInt.fromI32(250) // Default 2.5%
    globalState.burnFeeBasisPoints = BigInt.fromI32(50) // Default 0.5%
    globalState.feeRecipient = Bytes.fromHexString("0x0000000000000000000000000000000000000000")
    globalState.totalPlayAllTime = ZERO
    globalState.stakersCount = ZERO
    globalState.uniquePlayersCount = ZERO
    globalState.totalAssets = ZERO
    globalState.totalShares = ZERO
    globalState.pendingBets = ZERO
    globalState.lastRoundResolved = ZERO
    globalState.roundTransitionInProgress = false
    globalState.largeWithdrawalBatchSize = BigInt.fromI32(5)
    globalState.maxQueueLength = BigInt.fromI32(100)
    globalState.totalPendingLargeWithdrawals = ZERO
    globalState.totalFees = ZERO
    globalState.minJackpotCondition = ZERO
    globalState.totalTransfersToPool = ZERO
    globalState.totalDeposits = ZERO
    globalState.totalTransfersToPoolAtLastClean = ZERO
    globalState.totalDepositsAtLastClean = ZERO

    // Chainlink / keeper config (required non-null fields)
    globalState.chainlinkKeeperRegistry = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000")
    globalState.chainlinkKeeperRegistrar = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000")
    globalState.subscriptionId = ZERO
    globalState.liquidityEscrow = Bytes.fromHexString("0x0000000000000000000000000000000000000000")
    globalState.liquidityOpsPerCleaningUpkeep = BigInt.fromI32(40)
    globalState.lastBettingWindowClosedRoundId = ZERO
    globalState.lastBettingWindowClosedAt = ZERO
  }
  return globalState
}

/**
 * Get the day ID for a timestamp (rounds down to midnight UTC)
 * This is used as the ID for daily snapshots
 */
function getDayId(timestamp: BigInt): Bytes {
  const SECONDS_PER_DAY = BigInt.fromI32(86400) // 24 * 60 * 60
  const daysSinceEpoch = timestamp.div(SECONDS_PER_DAY)
  return bigintToBytes(daysSinceEpoch)
}

/**
 * Create or update a daily APY snapshot
 * Snapshots are taken once per day (at most) to track historical share values
 */
function createOrUpdateSnapshot(
  totalAssets: BigInt,
  totalShares: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt
): void {
  const dayId = getDayId(timestamp)
  let snapshot = APYSnapshot.load(dayId)
  
  // Only create snapshot if it doesn't exist for this day
  // This ensures we only snapshot once per day
  if (!snapshot) {
    snapshot = new APYSnapshot(dayId)
    snapshot.totalAssets = totalAssets
    snapshot.totalShares = totalShares
    snapshot.timestamp = timestamp
    snapshot.blockNumber = blockNumber
    snapshot.save()
  }
}

/**
 * Get snapshot from N days ago
 * Returns null if no snapshot exists for that period
 */
function getSnapshotFromDaysAgo(currentTimestamp: BigInt, daysAgo: BigInt): APYSnapshot | null {
  const SECONDS_PER_DAY = BigInt.fromI32(86400)
  const targetTimestamp = currentTimestamp.minus(daysAgo.times(SECONDS_PER_DAY))
  const targetDayId = getDayId(targetTimestamp)
  return APYSnapshot.load(targetDayId)
}

/**
 * Generic APY calculation based on the change in share value over time
 * APY = ((currentShareValue / baselineShareValue) - 1) * (365 * 24 * 3600 / timeElapsed) * 100
 * 
 * @param currentTotalAssets - Current total assets in the vault
 * @param currentTotalShares - Current total shares in the vault
 * @param baselineTotalAssets - Baseline total assets at reference point
 * @param baselineTotalShares - Baseline total shares at reference point
 * @param currentTimestamp - Current block timestamp
 * @param baselineTimestamp - Baseline timestamp (reference point)
 * @returns APY as a percentage (BigDecimal)
 */
function calculateAPYInternal(
  currentTotalAssets: BigInt,
  currentTotalShares: BigInt,
  baselineTotalAssets: BigInt,
  baselineTotalShares: BigInt,
  currentTimestamp: BigInt,
  baselineTimestamp: BigInt
): BigDecimal {
  // If there are no shares or no assets currently, APY is 0
  if (currentTotalShares.equals(ZERO) || currentTotalAssets.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }

  // If baseline hasn't been set yet, return 0
  if (baselineTimestamp.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }

  // If baseline shares or assets are 0, we can't calculate
  if (baselineTotalShares.equals(ZERO) || baselineTotalAssets.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }

  // Calculate time elapsed since the baseline
  const timeElapsed = currentTimestamp.minus(baselineTimestamp)
  
  // Avoid division by zero or negative time
  if (timeElapsed.le(ZERO)) {
    return BigDecimal.fromString("0")
  }

  // Calculate current share value (assets per share) with precision
  const PRECISION = BigInt.fromI32(10).pow(18)
  const currentShareValue = currentTotalAssets.times(PRECISION).div(currentTotalShares)
  
  // Calculate baseline share value
  const baselineShareValue = baselineTotalAssets.times(PRECISION).div(baselineTotalShares)
  
  // Calculate growth rate: (currentValue / baselineValue) - 1
  const growthRate = currentShareValue.toBigDecimal()
    .div(baselineShareValue.toBigDecimal())
    .minus(BigDecimal.fromString("1"))
  
  // Annualize the rate: growth * (seconds per year / time elapsed)
  const SECONDS_PER_YEAR = BigDecimal.fromString("31536000") // 365 * 24 * 60 * 60
  const annualizationFactor = SECONDS_PER_YEAR.div(timeElapsed.toBigDecimal())
  
  // Calculate APY as percentage
  const apy = growthRate.times(annualizationFactor).times(BigDecimal.fromString("100"))
  
  return apy
}

/**
 * Calculate all APY metrics using true rolling windows with daily snapshots
 * 
 * This approach:
 * 1. Takes daily snapshots of totalAssets/totalShares
 * 2. For each APY window, looks back exactly N days using snapshots
 * 3. Never shows 0% after reset - always uses actual trailing data
 * 
 * @param globalState - The global state entity
 * @param currentTimestamp - Current block timestamp
 * @param blockNumber - Current block number
 */
export function calculateAllAPYs(globalState: GlobalState, currentTimestamp: BigInt, blockNumber: BigInt): void {
  // Create a snapshot if we haven't taken one today
  const SECONDS_PER_DAY = BigInt.fromI32(86400)
  const timeSinceLastSnapshot = currentTimestamp.minus(globalState.lastApySnapshotTimestamp)
  
  if (timeSinceLastSnapshot.ge(SECONDS_PER_DAY) || globalState.lastApySnapshotTimestamp.equals(ZERO)) {
    createOrUpdateSnapshot(globalState.totalAssets, globalState.totalShares, currentTimestamp, blockNumber)
    globalState.lastApySnapshotTimestamp = currentTimestamp
  }

  // Set lifetime baseline on first deposit (only once, never changes)
  if (globalState.apyLifetimeBaselineTimestamp.equals(ZERO)) {
    globalState.apyLifetimeBaselineTimestamp = currentTimestamp
    globalState.apyLifetimeBaselineTotalAssets = globalState.totalAssets
    globalState.apyLifetimeBaselineTotalShares = globalState.totalShares
  }

  // Calculate 7-day APY using snapshot from 7 days ago
  const snapshot7DaysAgo = getSnapshotFromDaysAgo(currentTimestamp, BigInt.fromI32(7))
  if (snapshot7DaysAgo) {
    globalState.apy7Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      snapshot7DaysAgo.totalAssets,
      snapshot7DaysAgo.totalShares,
      currentTimestamp,
      snapshot7DaysAgo.timestamp
    )
  } else {
    // If no snapshot from 7 days ago exists, use lifetime (we're less than 7 days old)
    globalState.apy7Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      globalState.apyLifetimeBaselineTotalAssets,
      globalState.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      globalState.apyLifetimeBaselineTimestamp
    )
  }

  // Calculate 30-day APY using snapshot from 30 days ago
  const snapshot30DaysAgo = getSnapshotFromDaysAgo(currentTimestamp, BigInt.fromI32(30))
  if (snapshot30DaysAgo) {
    globalState.apy30Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      snapshot30DaysAgo.totalAssets,
      snapshot30DaysAgo.totalShares,
      currentTimestamp,
      snapshot30DaysAgo.timestamp
    )
  } else {
    // If no snapshot from 30 days ago exists, use lifetime
    globalState.apy30Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      globalState.apyLifetimeBaselineTotalAssets,
      globalState.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      globalState.apyLifetimeBaselineTimestamp
    )
  }

  // Calculate 365-day APY using snapshot from 365 days ago
  const snapshot365DaysAgo = getSnapshotFromDaysAgo(currentTimestamp, BigInt.fromI32(365))
  if (snapshot365DaysAgo) {
    globalState.apy365Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      snapshot365DaysAgo.totalAssets,
      snapshot365DaysAgo.totalShares,
      currentTimestamp,
      snapshot365DaysAgo.timestamp
    )
  } else {
    // If no snapshot from 365 days ago exists, use lifetime
    globalState.apy365Day = calculateAPYInternal(
      globalState.totalAssets,
      globalState.totalShares,
      globalState.apyLifetimeBaselineTotalAssets,
      globalState.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      globalState.apyLifetimeBaselineTimestamp
    )
  }

  // Calculate lifetime APY (always from inception)
  globalState.apyLifetime = calculateAPYInternal(
    globalState.totalAssets,
    globalState.totalShares,
    globalState.apyLifetimeBaselineTotalAssets,
    globalState.apyLifetimeBaselineTotalShares,
    currentTimestamp,
    globalState.apyLifetimeBaselineTimestamp
  )
}

export { GLOBAL_STATE_ID }
