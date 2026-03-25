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
  RouletteRound,
  RouletteBet,
  StakedBRBDeposit,
  StakedBRBWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction,
  BettingWindowClosedLog,
  QueuedLiquidityRejectedLog,
  WithdrawalEjectedLog
} from "../../generated/schema"
import { BET_STRAIGHT, BET_SPLIT, BET_STREET, BET_CORNER, BET_LINE, BET_COLUMN, BET_DOZEN, BET_RED, BET_BLACK, BET_ODD, BET_EVEN, BET_LOW, BET_HIGH, BET_TRIO_012, BET_TRIO_023, BET_TYPE_STRAIGHT, BET_TYPE_SPLIT, BET_TYPE_STREET, BET_TYPE_CORNER, BET_TYPE_LINE, BET_TYPE_COLUMN, BET_TYPE_DOZEN, BET_TYPE_RED, BET_TYPE_BLACK, BET_TYPE_ODD, BET_TYPE_EVEN, BET_TYPE_LOW, BET_TYPE_HIGH, BET_TYPE_TRIO_012, BET_TYPE_TRIO_023, ROUND_STATUS_BETTING, JACKPOT_CONTRACT_ADDRESS, STAKED_BRB_CONTRACT_ADDRESS } from "../helpers/constant"
import { updateUserStakingStats, updateUserRouletteStats, updateUserSBRBBalance, getOrCreateUser, updateUserDepositCostBasis, updateUserWithdrawalCostBasis } from "../helpers/user"
import { decodeWrapper } from "../helpers/decodeWrapper"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState, calculateAllAPYs } from "../helpers/globalState"
import { ONE } from "../helpers/number"

function zerosArray(length: number): Array<BigInt> {
  const arr = new Array<BigInt>(length)
  for (let i = 0; i < length; i++) {
    arr[i] = BigInt.fromI32(0)
  }
  return arr
}

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
  
  // Update cumulative deposit cost basis
  updateUserDepositCostBasis(event.params.owner, event.params.assets, event.params.shares)

  // Track cumulative deposits in GlobalState for donation calculation
  globalState.totalDeposits = globalState.totalDeposits.plus(event.params.assets)

  // Update global totals
  globalState.totalAssets = globalState.totalAssets.plus(event.params.assets)
  globalState.totalShares = globalState.totalShares.plus(event.params.shares)
  
  // Recalculate all APYs after deposit (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)
  
  globalState.save()
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

  // Calculate donations for this round: (current transfers - last clean transfers) - (current deposits - last clean deposits) - bets
  const transfersThisRound = globalState.totalTransfersToPool.minus(globalState.totalTransfersToPoolAtLastClean)
  const depositsThisRound = globalState.totalDeposits.minus(globalState.totalDepositsAtLastClean)
  const donations = transfersThisRound.minus(depositsThisRound).minus(round.totalBets)
  
  // Add donations to totalAssets (direct donations that weren't tracked via Deposit events)
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

  globalState.save()
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
  
  // Update cumulative deposit cost basis (remove cost basis of withdrawn shares)
  updateUserWithdrawalCostBasis(event.params.owner, event.params.shares)

  const withdrawTransaction = WithdrawTransaction.load(event.transaction.hash)
  if (withdrawTransaction == null) {
    new WithdrawTransaction(event.transaction.hash).save()
  }

  // Check if user will have zero sBRB balance after this withdrawal
  // The balance update happens in handleTransfer, so we check if shares withdrawn equals current balance
  const willBeZeroBalance = user.sbrbBalance.equals(event.params.shares)

  // Update global totals
  globalState.totalAssets = globalState.totalAssets.minus(event.params.assets)
  globalState.totalShares = globalState.totalShares.minus(event.params.shares)
  
  // Decrement stakers count if user unstakes everything
  if (willBeZeroBalance) {
    globalState.stakersCount = globalState.stakersCount.minus(ONE)
  }
  
  // Recalculate all APYs after withdrawal (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)
  
  globalState.save()
}

export function handleWithdrawalRequested(event: WithdrawalRequested): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.user)

  const requestId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.user
  request.amount = event.params.amount
  request.queuePosition = BigInt.fromI32(0)
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

  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.minus(event.params.amount)
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
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update burn fee basis points
  globalState.burnFeeBasisPoints = event.params.newFee
  globalState.save()
}

export function handleJackpotFeeRateUpdated(event: JackpotFeeRateUpdated): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update jackpot fee basis points
  globalState.jackpotFeeBasisPoints = event.params.newFee
  globalState.save()
}

export function handleProtocolFeeRateUpdated(event: ProtocolFeeRateUpdated): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Update protocol fee basis points
  // The ABI shows only one parameter: newFee
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

function getBetTypeFromNumber(betTypeNumber: BigInt): string {
  const betTypeInt = betTypeNumber.toI32()
  switch (betTypeInt) {
    case BET_STRAIGHT:
      return BET_TYPE_STRAIGHT
    case BET_SPLIT:
      return BET_TYPE_SPLIT
    case BET_STREET:
      return BET_TYPE_STREET
    case BET_CORNER:
      return BET_TYPE_CORNER
    case BET_LINE:
      return BET_TYPE_LINE
    case BET_COLUMN:
      return BET_TYPE_COLUMN
    case BET_DOZEN:
      return BET_TYPE_DOZEN
    case BET_RED:
      return BET_TYPE_RED
    case BET_BLACK:
      return BET_TYPE_BLACK
    case BET_ODD:
      return BET_TYPE_ODD
    case BET_EVEN:
      return BET_TYPE_EVEN
    case BET_LOW:
      return BET_TYPE_LOW
    case BET_HIGH:
      return BET_TYPE_HIGH
    case BET_TRIO_012:
      return BET_TYPE_TRIO_012
    case BET_TRIO_023:
      return BET_TYPE_TRIO_023
    default:
      return BET_TYPE_STRAIGHT
  }
}

function max3(a: BigInt, b: BigInt, c: BigInt): BigInt {
  let m = a
  if (b.gt(m)) m = b
  if (c.gt(m)) m = c
  return m
}

function updateRoundMaxPayoutComponents(round: RouletteRound, amount: BigInt, betType: BigInt, number: BigInt): void {
  const betTypeInt = betType.toI32()
  const numI32 = number.toI32()

  if (betTypeInt == BET_STRAIGHT) {
    // roundStraightBetsTotal += amount, and potentially update roundMaxStraightBet
    const totals = round.straightBetsTotals
    const next = totals[numI32].plus(amount)
    totals[numI32] = next
    round.straightBetsTotals = totals
    if (next.gt(round.maxStraightBet)) {
      round.maxStraightBet = next
    }
  } else if (betTypeInt == BET_STREET) {
    const totals = round.streetBetsTotals
    const next = totals[numI32].plus(amount)
    totals[numI32] = next
    round.streetBetsTotals = totals
    if (next.gt(round.maxStreetBet)) {
      round.maxStreetBet = next
    }
  } else if (betTypeInt == BET_RED) {
    round.redBetsSum = round.redBetsSum.plus(amount)
  } else if (betTypeInt == BET_BLACK) {
    round.blackBetsSum = round.blackBetsSum.plus(amount)
  } else if (betTypeInt == BET_ODD) {
    round.oddBetsSum = round.oddBetsSum.plus(amount)
  } else if (betTypeInt == BET_EVEN) {
    round.evenBetsSum = round.evenBetsSum.plus(amount)
  } else if (betTypeInt == BET_LOW) {
    round.lowBetsSum = round.lowBetsSum.plus(amount)
  } else if (betTypeInt == BET_HIGH) {
    round.highBetsSum = round.highBetsSum.plus(amount)
  } else if (betTypeInt == BET_DOZEN) {
    const sums = round.dozenBetsSum
    const next = sums[numI32].plus(amount)
    sums[numI32] = next
    round.dozenBetsSum = sums
  } else if (betTypeInt == BET_COLUMN) {
    const sums = round.columnBetsSum
    const next = sums[numI32].plus(amount)
    sums[numI32] = next
    round.columnBetsSum = sums
  } else if (betTypeInt == BET_SPLIT) {
    // payout = amount * 18 (added to otherBetsPayout)
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(18)))
  } else if (betTypeInt == BET_CORNER) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(9)))
  } else if (betTypeInt == BET_LINE) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(6)))
  } else if (betTypeInt == BET_TRIO_012 || betTypeInt == BET_TRIO_023) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(12)))
  }
}

function calculateMaxPayoutFromRoundComponents(round: RouletteRound): BigInt {
  // Mirrors RouletteLib + safety buffer logic
  const straightComponent = round.maxStraightBet.times(BigInt.fromI32(36)).plus(round.maxStreetBet.times(BigInt.fromI32(12)))

  const redBlackComponent = (round.redBetsSum.gt(round.blackBetsSum) ? round.redBetsSum : round.blackBetsSum).times(BigInt.fromI32(2))
  const oddEvenComponent = (round.oddBetsSum.gt(round.evenBetsSum) ? round.oddBetsSum : round.evenBetsSum).times(BigInt.fromI32(2))
  const lowHighComponent = (round.lowBetsSum.gt(round.highBetsSum) ? round.lowBetsSum : round.highBetsSum).times(BigInt.fromI32(2))
  const pairComponent = redBlackComponent.plus(oddEvenComponent).plus(lowHighComponent)

  const dozenSums = round.dozenBetsSum
  const dozenMax = max3(dozenSums[1], dozenSums[2], dozenSums[3])
  const dozenComponent = dozenMax.times(BigInt.fromI32(3))

  const columnSums = round.columnBetsSum
  const columnMax = max3(columnSums[1], columnSums[2], columnSums[3])
  const columnComponent = columnMax.times(BigInt.fromI32(3))

  const otherComponent = round.otherBetsPayout

  const raw = straightComponent.plus(pairComponent).plus(dozenComponent).plus(columnComponent).plus(otherComponent)

  // SAFETY_BUFFER_BPS = 11000 (110%) with floor division by 10000
  return raw.times(BigInt.fromI32(11000)).div(BigInt.fromI32(10000))
}

function processRouletteBet(user: Bytes, amount: BigInt, betType: BigInt, number: BigInt, round: RouletteRound, event: BetPlaced): void {
  // Create or update bet entity (user + round ID)
  const betId = user.concat(round.id)
  let bet = RouletteBet.load(betId)

  if (!bet) {
    // Create new bet entity
    bet = new RouletteBet(betId)
    bet.user = user
    bet.round = round.id
    bet.amounts = [amount]
    bet.betTypes = [getBetTypeFromNumber(betType)]
    bet.numbers = [number]
    bet.totalAmount = amount
    bet.betCount = BigInt.fromI32(1)
    bet.firstBetBlockNumber = event.block.number
    bet.firstBetTimestamp = event.block.timestamp
    bet.latestBetBlockNumber = event.block.number
    bet.latestBetTimestamp = event.block.timestamp
    bet.latestTransactionHash = event.transaction.hash
  } else {
    // Update existing bet entity
    const currentAmounts = bet.amounts
    const currentBetTypes = bet.betTypes
    const currentNumbers = bet.numbers

    currentAmounts.push(amount)
    currentBetTypes.push(getBetTypeFromNumber(betType))
    currentNumbers.push(number)

    bet.amounts = currentAmounts
    bet.betTypes = currentBetTypes
    bet.numbers = currentNumbers
    bet.totalAmount = bet.totalAmount.plus(amount)
    bet.betCount = bet.betCount.plus(BigInt.fromI32(1))
    bet.latestBetBlockNumber = event.block.number
    bet.latestBetTimestamp = event.block.timestamp
    bet.latestTransactionHash = event.transaction.hash
  }

  bet.save()

  // Update round totals
  round.totalBets = round.totalBets.plus(amount)
  updateRoundMaxPayoutComponents(round, amount, betType, number)
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

    // Process each bet
    for (let i = 0; i < amountsLength; i++) {
      // Process the individual bet (create/update RouletteBet entity + update maxPayout components)
      processRouletteBet(event.params.user, amounts[i], betTypes[i], numbers[i], round, event)
    }

    // Compute and persist maxPayout after processing the full decoded bet batch
    const maxPayoutThisCall = calculateMaxPayoutFromRoundComponents(round)

    // StakedBRB increases both:
    // - per-round maxPayoutPerRound[roundId] += maxPayout
    // - global maxPayout (i.e., $.maxPayout) += maxPayout
    round.maxBetAmount = round.maxBetAmount.plus(maxPayoutThisCall)
    globalState.maxBetAmount = globalState.maxBetAmount.plus(maxPayoutThisCall)

    round.save()
  }
  
  globalState.save()
}

export function handleTransfer(event: StakedBRBTransfer): void {
  // This handles ERC4626 share transfers (sBRB tokens)
  // Update sBRB balances for users
  
  // Skip if this is a mint (from zero address) or burn (to zero address)
  // if (event.params.from.toHexString() == "0x0000000000000000000000000000000000000000" || 
  //     event.params.to.toHexString() == "0x0000000000000000000000000000000000000000") {
  //   return
  // }

  // Update sBRB balances
  updateUserSBRBBalance(event.params.from, event.params.value, false) // Subtract from sender
  updateUserSBRBBalance(event.params.to, event.params.value, true)   // Add to receiver
}


