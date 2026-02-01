import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  Deposit,
  Withdraw,
  Transfer as StakedBRBTransfer,
  LargeWithdrawalRequested,
  LargeWithdrawalProcessed,
  ProtocolFeeRateUpdated,
  BetPlaced,
  WithdrawalSettingsUpdated,
  AntiSpamSettingsUpdated,
  BurnFeeRateUpdated,
  JackpotFeeRateUpdated,
  ProtocolFeeRecipientUpdated
} from "../../generated/StakedBRB/StakedBRB"
import {
  RouletteRound,
  RouletteBet,
  StakedBRBDeposit,
  StakedBRBWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction
} from "../../generated/schema"
import { BET_STRAIGHT, BET_SPLIT, BET_STREET, BET_CORNER, BET_LINE, BET_COLUMN, BET_DOZEN, BET_RED, BET_BLACK, BET_ODD, BET_EVEN, BET_LOW, BET_HIGH, BET_TRIO_012, BET_TRIO_023, BET_TYPE_STRAIGHT, BET_TYPE_SPLIT, BET_TYPE_STREET, BET_TYPE_CORNER, BET_TYPE_LINE, BET_TYPE_COLUMN, BET_TYPE_DOZEN, BET_TYPE_RED, BET_TYPE_BLACK, BET_TYPE_ODD, BET_TYPE_EVEN, BET_TYPE_LOW, BET_TYPE_HIGH, BET_TYPE_TRIO_012, BET_TYPE_TRIO_023, ROUND_STATUS_BETTING } from "../helpers/constant"
import { updateUserStakingStats, updateUserRouletteStats, updateUserSBRBBalance, getOrCreateUser } from "../helpers/user"
import { decodeWrapper } from "../helpers/decodeWrapper"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState, calculateAllAPYs } from "../helpers/globalState"

export function handleDeposit(event: Deposit): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()
  
  // Get or create user and check if this is their first stake
  const user = getOrCreateUser(event.params.owner)
  const isFirstStake = user.sbrbBalance.equals(BigInt.fromI32(0))

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

  // Update global totals
  globalState.totalAssets = globalState.totalAssets.plus(event.params.assets)
  globalState.totalShares = globalState.totalShares.plus(event.params.shares)
  
  // Increment stakers count if this is user's first stake
  if (isFirstStake) {
    globalState.stakersCount = globalState.stakersCount.plus(BigInt.fromI32(1))
  }
  
  // Recalculate all APYs after deposit (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)
  
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
    globalState.stakersCount = globalState.stakersCount.minus(BigInt.fromI32(1))
  }
  
  // Recalculate all APYs after withdrawal (handles baseline setting and snapshots)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)
  
  globalState.save()
}

export function handleLargeWithdrawalRequested(event: LargeWithdrawalRequested): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Create large withdrawal request entity
  const requestId = event.params.user.concat(bigintToBytes(event.block.timestamp))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.user
  request.amount = event.params.amount
  request.queuePosition = BigInt.fromI32(0) // Will be updated when processed
  request.requestedAt = event.block.timestamp
  request.isCancelled = false
  request.blockNumber = event.block.number
  request.transactionHash = event.transaction.hash
  request.save()

  // Update global totals
  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.plus(event.params.amount)
  globalState.save()
}

export function handleLargeWithdrawalProcessed(event: LargeWithdrawalProcessed): void {
  // Get or create GlobalState entity
  const globalState = getOrCreateGlobalState()

  // Find and update the large withdrawal request
  const requestId = event.params.user.concat(bigintToBytes(event.block.timestamp))
  const request = LargeWithdrawalRequest.load(requestId)
  if (request) {
    request.processedAt = event.block.timestamp
    request.save()
  }

  // Update user stats
  updateUserStakingStats(event.params.user, event.params.amount, false)

  // Update global totals
  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.minus(event.params.amount)
  globalState.save()
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

function processRouletteBet(user: Bytes, amount: BigInt, betType: BigInt, number: BigInt, roundId: Bytes, event: BetPlaced): void {
  // Get or create round
  let round = RouletteRound.load(roundId);

  if (round == null) return log.critical("Round not found for bet placement: {}", [roundId.toString()])
  // Create or update bet entity (user + round ID)
  const betId = user.concat(roundId)
  let bet = RouletteBet.load(betId)
  
  if (!bet) {
    // Create new bet entity
    bet = new RouletteBet(betId);
    bet.user = user;
    bet.round = roundId;
    bet.amounts = [amount];
    bet.betTypes = [getBetTypeFromNumber(betType)];
    bet.numbers = [number];
    bet.totalAmount = amount;
    bet.betCount = BigInt.fromI32(1);
    bet.firstBetBlockNumber = event.block.number;
    bet.firstBetTimestamp = event.block.timestamp;
    bet.latestBetBlockNumber = event.block.number;
    bet.latestBetTimestamp = event.block.timestamp;
    bet.latestTransactionHash = event.transaction.hash;
  } else {
    // Update existing bet entity
    const currentAmounts = bet.amounts;
    const currentBetTypes = bet.betTypes;
    const currentNumbers = bet.numbers;
    
    currentAmounts.push(amount);
    currentBetTypes.push(getBetTypeFromNumber(betType));
    currentNumbers.push(number);
    
    bet.amounts = currentAmounts;
    bet.betTypes = currentBetTypes;
    bet.numbers = currentNumbers;
    bet.totalAmount = bet.totalAmount.plus(amount);
    bet.betCount = bet.betCount.plus(BigInt.fromI32(1));
    bet.latestBetBlockNumber = event.block.number;
    bet.latestBetTimestamp = event.block.timestamp;
    bet.latestTransactionHash = event.transaction.hash;
  }
  
  bet.save();

  // Update round totals
  round.totalBets = round.totalBets.plus(amount);
  
  // Track max bet amount in this round
  if (bet.totalAmount.gt(round.maxBetAmount)) {
    round.maxBetAmount = bet.totalAmount;
  }
  
  round.save();
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
    // Process each bet
    for (let i = 0; i < amountsLength; i++) {
      // Process the individual bet (create/update RouletteBet entity)
      processRouletteBet(event.params.user, amounts[i], betTypes[i], numbers[i], bigintToBytes(event.params.roundId), event)
      // Update user roulette stats
    }
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


