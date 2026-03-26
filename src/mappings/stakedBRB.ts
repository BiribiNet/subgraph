import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  Deposit,
  Withdraw,
  Transfer as StakedBRBTransfer,
  WithdrawalRequested,
  WithdrawalProcessed,
  ProtocolFeeRateUpdated,
  BetPlaced,
  WithdrawalSettingsUpdated,
  AntiSpamSettingsUpdated,
  BurnFeeRateUpdated,
  JackpotFeeRateUpdated,
  ProtocolFeeRecipientUpdated,
  RoundCleaningCompleted,
  BettingWindowClosed,
  LiquidityEscrowSet,
  LiquidityOpsPerUpkeepUpdated,
  QueuedLiquidityRejected,
  WithdrawalEjected
} from "../../generated/StakedBRB/StakedBRB"
import {
  Approval,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
  Initialized,
  Upgraded,
  CleaningUpkeepRegistered,
  UpkeepRegistered,
  MaxSupportedBetsUpdated
} from "../../generated/StakedBRB/MergedEvents"
import {
  RouletteRound,
  RouletteBet,
  StakedBRBDeposit,
  StakedBRBWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction,
  BettingWindowClosedLog,
  QueuedLiquidityRejectedLog,
  WithdrawalEjectedLog,
  TokenApproval,
  AdminRoleChange,
  ContractUpgrade,
  UpkeepRegistration,
  MaxBetsUpdate
} from "../../generated/schema"
import { ROUND_STATUS_BETTING } from "../helpers/constant"
import { updateUserStakingStats, updateUserRouletteStats, updateUserSBRBBalance, getOrCreateUser, updateUserDepositCostBasis, updateUserWithdrawalCostBasis, updateUserLastActive } from "../helpers/user"
import { decodeWrapper } from "../helpers/decodeWrapper"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState, calculateAllAPYs, updateSharePrice, getOrCreateProtocolStats, calculateSharePrice, syncVaultState } from "../helpers/globalState"
import { ONE, ZERO } from "../helpers/number"
import { getOrCreateDailyStats, trackDailyUniquePlayer, getOrCreateHourlySnapshot, trackHourlyUniquePlayer } from "../helpers/aggregation"
import { processRouletteBet, calculateMaxPayoutFromRoundComponents } from "../helpers/betting"

export function handleDeposit(event: Deposit): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Create deposit entity
  const depositId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const deposit = new StakedBRBDeposit(depositId)
  deposit.user = event.params.owner
  deposit.assets = event.params.assets
  deposit.shares = event.params.shares
  deposit.blockNumber = event.block.number
  deposit.timestamp = event.block.timestamp
  deposit.transactionHash = event.transaction.hash
  deposit.save()

  // Update user stats
  updateUserStakingStats(event.params.owner, event.params.assets, true)
  updateUserLastActive(event.params.owner, event.block.timestamp)

  // Update cumulative deposit cost basis
  updateUserDepositCostBasis(event.params.owner, event.params.assets, event.params.shares)

  // Track cumulative deposits in GlobalState for donation calculation
  globalState.totalDeposits = globalState.totalDeposits.plus(event.params.assets)

  // Update global totals
  globalState.totalAssets = globalState.totalAssets.plus(event.params.assets)
  globalState.totalShares = globalState.totalShares.plus(event.params.shares)
  
  // Update share price
  updateSharePrice(globalState)

  // Recalculate all APYs after deposit (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)

  // Update DailyStats with deposit volume
  const dailyStatsDeposit = getOrCreateDailyStats(event.block.timestamp)
  dailyStatsDeposit.depositVolume = dailyStatsDeposit.depositVolume.plus(event.params.assets)
  dailyStatsDeposit.depositCount = dailyStatsDeposit.depositCount.plus(BigInt.fromI32(1))
  dailyStatsDeposit.vaultSharePrice = calculateSharePrice(globalState.totalAssets, globalState.totalShares)
  dailyStatsDeposit.save()

  // Update HourlyVolumeSnapshot with deposit volume
  const hourlyDeposit = getOrCreateHourlySnapshot(event.block.timestamp)
  hourlyDeposit.depositVolume = hourlyDeposit.depositVolume.plus(event.params.assets)
  hourlyDeposit.save()

  // Update ProtocolStats cumulative deposit volume
  const protocolStatsDeposit = getOrCreateProtocolStats()
  protocolStatsDeposit.totalDeposited = protocolStatsDeposit.totalDeposited.plus(event.params.assets)
  protocolStatsDeposit.save()

  globalState.save()

  // Update VaultState singleton
  const vault = syncVaultState(globalState, event.block.timestamp)
  vault.save()
}

export function handleRoundCleaningCompleted(event: RoundCleaningCompleted): void {
  const globalState = getOrCreateGlobalState()
  const roundId = event.params.cleanedRoundId
  globalState.lastRoundResolved = roundId
  globalState.lastRoundStartTime = event.params.boundaryTimestamp
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for batch processing: {}", [roundId.toString()])
    return
  }
  globalState.roundTransitionInProgress = false;

  // StakedBRB reduces global $.maxPayout by maxPayoutPerRound[roundId].
  // The per-round value itself is NOT cleared in the contract, so we keep it as historical data.
  const roundMaxPayoutPerRound = round.maxBetAmount
  if (roundMaxPayoutPerRound.gt(BigInt.fromI32(0))) {
    if (roundMaxPayoutPerRound.ge(globalState.maxBetAmount)) {
      globalState.maxBetAmount = BigInt.fromI32(0)
    } else {
      globalState.maxBetAmount = globalState.maxBetAmount.minus(roundMaxPayoutPerRound)
    }
  }

  globalState.totalFees = globalState.totalFees.plus(event.params.fees.protocolFees)

  // Revenue breakdown per round
  round.infraRevenue = event.params.fees.protocolFees
  round.roundBurnAmount = event.params.fees.burnAmount
  round.jackpotRevenue = event.params.fees.jackpotAmount

  if (round.totalBets.gt(round.totalPayouts)) {
    const totalFeesAmount = event.params.fees.protocolFees
      .plus(event.params.fees.burnAmount)
      .plus(event.params.fees.jackpotAmount)
    round.stakersRevenue = round.totalBets.minus(round.totalPayouts).minus(totalFeesAmount)
  } else {
    round.stakersRevenue = ZERO
  }

  // Update cumulative staker revenue (stakersRevenue is always set above)
  const sr = round.stakersRevenue as BigInt
  if (sr.gt(ZERO)) {
    globalState.totalStakerRevenue = globalState.totalStakerRevenue.plus(sr)
  }

  // Update DailyStats with round completion data
  // Note: totalPayouts is tracked in real-time in brb.ts handleTransfer
  const dailyStats = getOrCreateDailyStats(event.block.timestamp)
  dailyStats.roundsCompleted = dailyStats.roundsCompleted.plus(BigInt.fromI32(1))
  if (round.totalBets.gt(round.totalPayouts)) {
    dailyStats.revenue = dailyStats.revenue.plus(round.totalBets.minus(round.totalPayouts))
  }
  dailyStats.vaultSharePrice = calculateSharePrice(globalState.totalAssets, globalState.totalShares)
  dailyStats.jackpotPool = globalState.currentJackpot
  if (round.stakersRevenue !== null) {
    const srDaily = round.stakersRevenue as BigInt
    if (srDaily.gt(ZERO)) {
      dailyStats.stakersRevenue = dailyStats.stakersRevenue.plus(srDaily)
    }
  }
  dailyStats.save()

  // Update HourlyVolumeSnapshot with round completion data
  const hourlyRound = getOrCreateHourlySnapshot(event.block.timestamp)
  if (round.stakersRevenue !== null) {
    const srHourly = round.stakersRevenue as BigInt
    if (srHourly.gt(ZERO)) {
      hourlyRound.stakersRevenue = hourlyRound.stakersRevenue.plus(srHourly)
    }
  }
  hourlyRound.save()

  // Calculate donations for this round: (current transfers - last clean transfers) - (current deposits - last clean deposits) - bets
  const transfersThisRound = globalState.totalTransfersToPool.minus(globalState.totalTransfersToPoolAtLastClean)
  const depositsThisRound = globalState.totalDeposits.minus(globalState.totalDepositsAtLastClean)
  const donations = transfersThisRound.minus(depositsThisRound).minus(round.totalBets)
  
  // Add donations to totalAssets (direct donations that weren't tracked via Deposit events)
  if (donations.lt(BigInt.fromI32(0))) {
    log.warning("Negative donation for round {}: amount={}, transfers={}, deposits={}, bets={}", [
      roundId.toString(),
      donations.toString(),
      transfersThisRound.toString(),
      depositsThisRound.toString(),
      round.totalBets.toString()
    ])
  }
  if (donations.gt(BigInt.fromI32(0))) {
    globalState.totalAssets = globalState.totalAssets.plus(donations)
  }

  // Update "at last clean" values for next round's calculation
  globalState.totalTransfersToPoolAtLastClean = globalState.totalTransfersToPool
  globalState.totalDepositsAtLastClean = globalState.totalDeposits

  if (round.totalBets.gt(round.totalPayouts)) { // pool won money
    globalState.totalAssets = globalState.totalAssets.plus(round.totalBets.minus(round.totalPayouts).minus(event.params.fees.protocolFees.plus(event.params.fees.burnAmount).plus(event.params.fees.jackpotAmount)))
  } else { // pool lost money
    globalState.totalAssets = globalState.totalAssets.plus(round.totalBets.minus(round.totalPayouts))
  }

  // Update share price and APYs after revenue distribution
  updateSharePrice(globalState)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)

  // Update VaultState singleton
  const vault = syncVaultState(globalState, event.block.timestamp)
  if (round.stakersRevenue !== null) {
    const sr = round.stakersRevenue as BigInt
    if (sr.gt(ZERO)) {
      vault.allTimeRevenue = vault.allTimeRevenue.plus(sr)
    }
  }
  vault.save()

  // Update ProtocolStats
  const protocolStats = getOrCreateProtocolStats()
  protocolStats.totalRounds = protocolStats.totalRounds.plus(ONE)
  if (round.stakersRevenue !== null) {
    const sr2 = round.stakersRevenue as BigInt
    if (sr2.gt(ZERO)) {
      protocolStats.totalStakerRevenue = protocolStats.totalStakerRevenue.plus(sr2)
    }
  }
  protocolStats.totalBurned = globalState.totalBurned
  protocolStats.save()

  round.cleaningCompletedAt = event.block.timestamp
  round.save()
}

export function handleWithdraw(event: Withdraw): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()
  
  // Get user to check if they'll have zero balance after withdrawal
  const user = getOrCreateUser(event.params.owner)

  // Create withdrawal entity
  const withdrawalId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const withdrawal = new StakedBRBWithdrawal(withdrawalId)
  withdrawal.user = event.params.owner
  withdrawal.assets = event.params.assets
  withdrawal.shares = event.params.shares
  withdrawal.blockNumber = event.block.number
  withdrawal.timestamp = event.block.timestamp
  withdrawal.transactionHash = event.transaction.hash
  withdrawal.save()

  // Update user stats
  updateUserStakingStats(event.params.owner, event.params.assets, false)
  updateUserLastActive(event.params.owner, event.block.timestamp)

  // Update cumulative deposit cost basis (remove cost basis of withdrawn shares)
  updateUserWithdrawalCostBasis(event.params.owner, event.params.shares)

  const withdrawTransaction = WithdrawTransaction.load(event.transaction.hash)
  if (withdrawTransaction == null) {
    const wt = new WithdrawTransaction(event.transaction.hash)
    wt.user = event.params.owner
    wt.blockNumber = event.block.number
    wt.timestamp = event.block.timestamp
    wt.save()
  }

  // Update global totals
  // Note: stakersCount is decremented in updateUserSBRBBalance (via handleTransfer)
  // when the sBRB Transfer event fires and balance reaches zero
  globalState.totalAssets = globalState.totalAssets.minus(event.params.assets)
  globalState.totalShares = globalState.totalShares.minus(event.params.shares)

  // Update share price
  updateSharePrice(globalState)

  // Recalculate all APYs after withdrawal (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)

  // Update DailyStats with withdrawal volume
  const dailyStatsWithdraw = getOrCreateDailyStats(event.block.timestamp)
  dailyStatsWithdraw.withdrawalVolume = dailyStatsWithdraw.withdrawalVolume.plus(event.params.assets)
  dailyStatsWithdraw.withdrawalCount = dailyStatsWithdraw.withdrawalCount.plus(BigInt.fromI32(1))
  dailyStatsWithdraw.vaultSharePrice = calculateSharePrice(globalState.totalAssets, globalState.totalShares)
  dailyStatsWithdraw.save()

  // Update HourlyVolumeSnapshot with withdrawal volume
  const hourlyWithdraw = getOrCreateHourlySnapshot(event.block.timestamp)
  hourlyWithdraw.withdrawalVolume = hourlyWithdraw.withdrawalVolume.plus(event.params.assets)
  hourlyWithdraw.save()

  // Update ProtocolStats cumulative withdrawal volume
  const protocolStatsWithdraw = getOrCreateProtocolStats()
  protocolStatsWithdraw.totalWithdrawn = protocolStatsWithdraw.totalWithdrawn.plus(event.params.assets)
  protocolStatsWithdraw.save()

  globalState.save()

  // Update VaultState singleton
  const vaultW = syncVaultState(globalState, event.block.timestamp)
  vaultW.save()
}

export function handleWithdrawalRequested(event: WithdrawalRequested): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.user)

  const requestId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.user
  request.amount = event.params.amount
  globalState.withdrawalQueueCounter = globalState.withdrawalQueueCounter.plus(ONE)
  request.queuePosition = globalState.withdrawalQueueCounter
  request.requestedAt = event.block.timestamp
  request.isCancelled = false
  request.blockNumber = event.block.number
  request.transactionHash = event.transaction.hash
  request.save()

  user.openWithdrawalRequestId = requestId
  user.save()

  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.plus(event.params.amount)
  globalState.save()
}

export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.user)

  const openReqId = user.openWithdrawalRequestId
  if (openReqId) {
    const req = LargeWithdrawalRequest.load(openReqId)
    if (req) {
      req.processedAt = event.block.timestamp
      req.save()
    }
    user.openWithdrawalRequestId = null
    user.save()
  }

  if (globalState.totalPendingLargeWithdrawals.lt(event.params.amount)) {
    log.warning("totalPendingLargeWithdrawals underflow: {} < {}", [
      globalState.totalPendingLargeWithdrawals.toString(),
      event.params.amount.toString()
    ])
    globalState.totalPendingLargeWithdrawals = ZERO
  } else {
    globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.minus(event.params.amount)
  }
  globalState.save()
}

export function handleBettingWindowClosed(event: BettingWindowClosed): void {
  const globalState = getOrCreateGlobalState()
  globalState.lastBettingWindowClosedRoundId = event.params.roundId
  globalState.lastBettingWindowClosedAt = event.block.timestamp
  globalState.save()

  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const row = new BettingWindowClosedLog(id)
  row.roundId = event.params.roundId
  row.blockNumber = event.block.number
  row.timestamp = event.block.timestamp
  row.transactionHash = event.transaction.hash
  row.save()
}

export function handleLiquidityEscrowSet(event: LiquidityEscrowSet): void {
  const globalState = getOrCreateGlobalState()
  globalState.liquidityEscrow = changetype<Bytes>(event.params.escrow)
  globalState.save()
}

export function handleLiquidityOpsPerUpkeepUpdated(event: LiquidityOpsPerUpkeepUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.liquidityOpsPerCleaningUpkeep = event.params.ops
  globalState.save()
}

export function handleQueuedLiquidityRejected(event: QueuedLiquidityRejected): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const row = new QueuedLiquidityRejectedLog(id)
  row.payer = changetype<Bytes>(event.params.payer)
  row.assets = event.params.assets
  row.reason = event.params.reason
  row.blockNumber = event.block.number
  row.timestamp = event.block.timestamp
  row.transactionHash = event.transaction.hash
  row.save()
}

export function handleWithdrawalEjected(event: WithdrawalEjected): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const row = new WithdrawalEjectedLog(id)
  row.user = changetype<Bytes>(event.params.user)
  row.reason = event.params.reason
  row.blockNumber = event.block.number
  row.timestamp = event.block.timestamp
  row.transactionHash = event.transaction.hash
  row.save()
}

export function handleBurnFeeRateUpdated(event: BurnFeeRateUpdated): void {
  const globalState = getOrCreateGlobalState()
  log.info("Burn fee updated: {} -> {} bps", [globalState.burnFeeBasisPoints.toString(), event.params.newFee.toString()])
  globalState.burnFeeBasisPoints = event.params.newFee
  globalState.save()
}

export function handleJackpotFeeRateUpdated(event: JackpotFeeRateUpdated): void {
  const globalState = getOrCreateGlobalState()
  log.info("Jackpot fee updated: {} -> {} bps", [globalState.jackpotFeeBasisPoints.toString(), event.params.newFee.toString()])
  globalState.jackpotFeeBasisPoints = event.params.newFee
  globalState.save()
}

export function handleProtocolFeeRateUpdated(event: ProtocolFeeRateUpdated): void {
  const globalState = getOrCreateGlobalState()
  log.info("Protocol fee updated: {} -> {} bps", [globalState.protocolFeeBasisPoints.toString(), event.params.newFee.toString()])
  globalState.protocolFeeBasisPoints = event.params.newFee
  globalState.save()
}

export function handleWithdrawalSettingsUpdated(event: WithdrawalSettingsUpdated): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update large withdrawal batch size
  globalState.largeWithdrawalBatchSize = event.params.batchSize
  globalState.save()
}

export function handleAntiSpamSettingsUpdated(event: AntiSpamSettingsUpdated): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update maximum queue length
  globalState.maxQueueLength = event.params.maxQueueLength
  globalState.save()
}

export function handleProtocolFeeRecipientUpdated(event: ProtocolFeeRecipientUpdated): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update protocol fee recipient
  globalState.feeRecipient = event.params.newRecipient
  globalState.save()
}


export function handleBetPlaced(event: BetPlaced): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState();
  
  // Get or create user to track unique players
  const user = getOrCreateUser(event.params.user)
  const isFirstBet = user.totalRouletteBets.equals(BigInt.fromI32(0))

  // Decode the bytes parameter to get multiple bets
  const decoded = decodeWrapper(event.params.data, "(uint256[],uint256[],uint256[])");
  
  globalState.pendingBets = globalState.pendingBets.plus(event.params.amount);
  // Update total play all time
  globalState.totalPlayAllTime = globalState.totalPlayAllTime.plus(event.params.amount)
  
  // Increment unique players count if this is user's first bet
  if (isFirstBet) {
    globalState.uniquePlayersCount = globalState.uniquePlayersCount.plus(BigInt.fromI32(1))
  }
  
  updateUserRouletteStats(event.params.user, event.params.amount, false, false);
  updateUserLastActive(event.params.user, event.block.timestamp);
  if (decoded) {
    const s = decoded.toTuple()
    const amounts = s[0].toBigIntArray()
    const betTypes = s[1].toBigIntArray()
    const numbers = s[2].toBigIntArray()
    const amountsLength = amounts.length;

    const roundId = bigintToBytes(event.params.roundId)
    let round = RouletteRound.load(roundId)
    if (round == null) {
      log.critical("Round not found for bet placement: {}", [roundId.toString()])
      return
    }

    // Check if this is the user's first bet in this round (for betCount tracking)
    const betEntityId = event.params.user.concat(roundId)
    const isNewBetForRound = RouletteBet.load(betEntityId) == null

    // Capture max payout BEFORE processing bets (for delta calculation)
    const previousMaxPayout = calculateMaxPayoutFromRoundComponents(round)

    // Process each bet
    for (let i = 0; i < amountsLength; i++) {
      // Process the individual bet (create/update RouletteBet entity + update maxPayout components)
      processRouletteBet(event.params.user, amounts[i], betTypes[i], numbers[i], round, event)
    }

    // Increment round's total individual bet count
    round.betCount = round.betCount.plus(BigInt.fromI32(amountsLength))

    // Increment user's betCount and round's uniqueBettors if first bet in round
    if (isNewBetForRound) {
      round.uniqueBettors = round.uniqueBettors.plus(ONE)
      const betUser = getOrCreateUser(event.params.user)
      betUser.betCount = betUser.betCount.plus(ONE)
      betUser.save()
    }

    // Compute max payout AFTER processing bets and use the delta
    const currentMaxPayout = calculateMaxPayoutFromRoundComponents(round)
    const delta = currentMaxPayout.minus(previousMaxPayout)

    // StakedBRB increases both:
    // - per-round maxPayoutPerRound[roundId] += delta
    // - global maxPayout (i.e., $.maxPayout) += delta
    round.maxBetAmount = round.maxBetAmount.plus(delta)
    globalState.maxBetAmount = globalState.maxBetAmount.plus(delta)

    round.save()
  }

  // Update DailyStats aggregation
  const dailyStats = getOrCreateDailyStats(event.block.timestamp)
  dailyStats.volume = dailyStats.volume.plus(event.params.amount)
  dailyStats.betCount = dailyStats.betCount.plus(BigInt.fromI32(1))
  const isNewDaily = trackDailyUniquePlayer(event.block.timestamp, event.params.user.toHexString())
  if (isNewDaily) {
    dailyStats.uniquePlayers = dailyStats.uniquePlayers.plus(BigInt.fromI32(1))
  }
  dailyStats.save()

  // Update HourlyVolumeSnapshot
  const hourly = getOrCreateHourlySnapshot(event.block.timestamp)
  hourly.volume = hourly.volume.plus(event.params.amount)
  hourly.betCount = hourly.betCount.plus(BigInt.fromI32(1))
  const isNewHourly = trackHourlyUniquePlayer(event.block.timestamp, event.params.user.toHexString())
  if (isNewHourly) {
    hourly.uniquePlayers = hourly.uniquePlayers.plus(BigInt.fromI32(1))
  }
  hourly.save()

  // Update ProtocolStats
  const protocolStats = getOrCreateProtocolStats()
  protocolStats.totalWagered = protocolStats.totalWagered.plus(event.params.amount)
  protocolStats.totalBets = protocolStats.totalBets.plus(ONE)
  if (isFirstBet) {
    protocolStats.totalPlayers = protocolStats.totalPlayers.plus(ONE)
  }
  protocolStats.save()

  globalState.save()
}

export function handleTransfer(event: StakedBRBTransfer): void {
  // Update sBRB balances for users (including mint/burn from zero address)
  updateUserSBRBBalance(event.params.from, event.params.value, false) // Subtract from sender
  updateUserSBRBBalance(event.params.to, event.params.value, true)   // Add to receiver
}

export function handleApproval(event: Approval): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const approval = new TokenApproval(id)
  approval.token = "sBRB"
  approval.owner = event.params.owner
  approval.spender = event.params.spender
  approval.value = event.params.value
  approval.blockNumber = event.block.number
  approval.timestamp = event.block.timestamp
  approval.transactionHash = event.transaction.hash
  approval.save()
}

export function handleVaultRoleGranted(event: RoleGranted): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "StakedBRB"
  entity.eventType = "GRANTED"
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleVaultRoleRevoked(event: RoleRevoked): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "StakedBRB"
  entity.eventType = "REVOKED"
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleVaultRoleAdminChanged(event: RoleAdminChanged): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "StakedBRB"
  entity.eventType = "ADMIN_CHANGED"
  entity.role = event.params.role
  entity.previousAdminRole = event.params.previousAdminRole
  entity.newAdminRole = event.params.newAdminRole
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleVaultInitialized(event: Initialized): void {
  log.info("StakedBRB contract initialized with version {}", [event.params.version.toString()])
}

export function handleVaultUpgraded(event: Upgraded): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new ContractUpgrade(id)
  entity.contract = "StakedBRB"
  entity.implementation = event.params.implementation
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleCleaningUpkeepRegistered(event: CleaningUpkeepRegistered): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new UpkeepRegistration(id)
  entity.registrationType = "CLEANING"
  entity.upkeepId = event.params.upkeepId
  entity.forwarder = event.params.forwarder
  entity.gasLimit = event.params.gasLimit
  entity.linkAmount = event.params.linkAmount
  entity.upkeepType = event.params.upkeepType
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleUpkeepRegistered(event: UpkeepRegistered): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new UpkeepRegistration(id)
  entity.registrationType = "STANDARD"
  entity.upkeepId = event.params.upkeepId
  entity.forwarder = event.params.forwarder
  entity.gasLimit = event.params.gasLimit
  entity.linkAmount = event.params.linkAmount
  entity.checkDataLength = event.params.checkDataLength
  entity.upkeepType = event.params.upkeepType
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleMaxSupportedBetsUpdated(event: MaxSupportedBetsUpdated): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new MaxBetsUpdate(id)
  entity.maxSupportedBets = event.params.maxSupportedBets
  entity.totalPayoutUpkeeps = event.params.totalPayoutUpkeeps
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}
