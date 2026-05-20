import { Address, BigInt, Bytes, dataSource, log } from "@graphprotocol/graph-ts"
import {
  Deposit,
  Withdraw,
  Transfer as StakedBRBTransfer,
  WithdrawalRequested,
  WithdrawalProcessed,
  BetPlaced,
  WithdrawalEjected,
  Approval,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged
} from "../../generated/BankVault4626_USDC/StakedBRB"
import { UpkeepRegistered } from "../../generated/BankVault4626_USDC/MergedEvents"
import {
  RouletteRound,
  RouletteBet,
  StakedBRBDeposit,
  StakedBRBWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction,
  WithdrawalEjectedLog,
  TokenApproval,
  AdminRoleChange,
  ContractUpgrade,
  UpkeepRegistration,
  Market
} from "../../generated/schema"
import { ROUND_STATUS_BETTING } from "../helpers/constant"
import { updateUserStakingStats, updateUserRouletteStats, updateUserSBRBBalance, getOrCreateUser, updateUserDepositCostBasis, updateUserWithdrawalCostBasis, updateUserLastActive } from "../helpers/user"
import { decodeWrapper } from "../helpers/decodeWrapper"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState, calculateAllAPYs, updateSharePrice, getOrCreateProtocolStats, calculateSharePrice, syncVaultState } from "../helpers/globalState"
import { ONE, ZERO } from "../helpers/number"
import { getOrCreateDailyStats, trackDailyUniquePlayer, getOrCreateHourlySnapshot, trackHourlyUniquePlayer } from "../helpers/aggregation"
import { processRouletteBet, calculateMaxPayoutFromRoundComponents } from "../helpers/betting"
import { createNewRouletteRound } from "../helpers/rouletteRound"
import { getOrCreateMarketByBank, loadMarketByBank } from "../helpers/market"

function currentBank(): Address {
  return dataSource.address()
}

function bankBytes(): Bytes {
  return changetype<Bytes>(dataSource.address())
}

function ensureMarketForBank(timestamp: BigInt): Market {
  return getOrCreateMarketByBank(currentBank(), timestamp)
}

export function handleDeposit(event: Deposit): void {
  const globalState = getOrCreateGlobalState()
  const market = ensureMarketForBank(event.block.timestamp)

  const depositId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const deposit = new StakedBRBDeposit(depositId)
  deposit.user = event.params.owner
  deposit.market = market.id
  deposit.bank = bankBytes()
  deposit.assets = event.params.assets
  deposit.shares = event.params.shares
  deposit.blockNumber = event.block.number
  deposit.timestamp = event.block.timestamp
  deposit.transactionHash = event.transaction.hash
  deposit.save()

  updateUserStakingStats(event.params.owner, event.params.assets, true, event.block.timestamp)
  updateUserLastActive(event.params.owner, event.block.timestamp)
  updateUserDepositCostBasis(event.params.owner, event.params.assets, event.params.shares)

  globalState.totalDeposits = globalState.totalDeposits.plus(event.params.assets)
  globalState.totalAssets = globalState.totalAssets.plus(event.params.assets)
  globalState.totalShares = globalState.totalShares.plus(event.params.shares)
  updateSharePrice(globalState)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)

  market.totalAssets = market.totalAssets.plus(event.params.assets)
  market.totalShares = market.totalShares.plus(event.params.shares)
  market.save()

  const dailyStatsDeposit = getOrCreateDailyStats(event.block.timestamp)
  dailyStatsDeposit.depositVolume = dailyStatsDeposit.depositVolume.plus(event.params.assets)
  dailyStatsDeposit.depositCount = dailyStatsDeposit.depositCount.plus(ONE)
  dailyStatsDeposit.vaultSharePrice = calculateSharePrice(globalState.totalAssets, globalState.totalShares)
  dailyStatsDeposit.save()

  const hourlyDeposit = getOrCreateHourlySnapshot(event.block.timestamp)
  hourlyDeposit.depositVolume = hourlyDeposit.depositVolume.plus(event.params.assets)
  hourlyDeposit.save()

  const protocolStatsDeposit = getOrCreateProtocolStats()
  protocolStatsDeposit.totalDeposited = protocolStatsDeposit.totalDeposited.plus(event.params.assets)
  protocolStatsDeposit.save()

  globalState.save()

  const vault = syncVaultState(globalState, event.block.timestamp)
  vault.save()
}

export function handleWithdraw(event: Withdraw): void {
  const globalState = getOrCreateGlobalState()
  const market = ensureMarketForBank(event.block.timestamp)
  const user = getOrCreateUser(event.params.owner)

  const withdrawalId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const withdrawal = new StakedBRBWithdrawal(withdrawalId)
  withdrawal.user = event.params.owner
  withdrawal.market = market.id
  withdrawal.bank = bankBytes()
  withdrawal.assets = event.params.assets
  withdrawal.shares = event.params.shares
  withdrawal.blockNumber = event.block.number
  withdrawal.timestamp = event.block.timestamp
  withdrawal.transactionHash = event.transaction.hash
  withdrawal.save()

  updateUserStakingStats(event.params.owner, event.params.assets, false, event.block.timestamp)
  updateUserLastActive(event.params.owner, event.block.timestamp)
  updateUserWithdrawalCostBasis(event.params.owner, event.params.shares)

  const withdrawTransaction = WithdrawTransaction.load(event.transaction.hash)
  if (withdrawTransaction == null) {
    const wt = new WithdrawTransaction(event.transaction.hash)
    wt.user = event.params.owner
    wt.blockNumber = event.block.number
    wt.timestamp = event.block.timestamp
    wt.save()
  }

  globalState.totalAssets = globalState.totalAssets.minus(event.params.assets)
  globalState.totalShares = globalState.totalShares.minus(event.params.shares)
  updateSharePrice(globalState)
  calculateAllAPYs(globalState, event.block.timestamp, event.block.number)

  market.totalAssets = market.totalAssets.minus(event.params.assets)
  market.totalShares = market.totalShares.minus(event.params.shares)
  market.save()

  const dailyStatsWithdraw = getOrCreateDailyStats(event.block.timestamp)
  dailyStatsWithdraw.withdrawalVolume = dailyStatsWithdraw.withdrawalVolume.plus(event.params.assets)
  dailyStatsWithdraw.withdrawalCount = dailyStatsWithdraw.withdrawalCount.plus(ONE)
  dailyStatsWithdraw.vaultSharePrice = calculateSharePrice(globalState.totalAssets, globalState.totalShares)
  dailyStatsWithdraw.save()

  const hourlyWithdraw = getOrCreateHourlySnapshot(event.block.timestamp)
  hourlyWithdraw.withdrawalVolume = hourlyWithdraw.withdrawalVolume.plus(event.params.assets)
  hourlyWithdraw.save()

  const protocolStatsWithdraw = getOrCreateProtocolStats()
  protocolStatsWithdraw.totalWithdrawn = protocolStatsWithdraw.totalWithdrawn.plus(event.params.assets)
  protocolStatsWithdraw.save()

  globalState.save()

  const vaultW = syncVaultState(globalState, event.block.timestamp)
  vaultW.save()
}

export function handleWithdrawalRequested(event: WithdrawalRequested): void {
  const globalState = getOrCreateGlobalState()
  const market = ensureMarketForBank(event.block.timestamp)
  const user = getOrCreateUser(event.params.owner)

  const requestId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.owner
  request.market = market.id
  request.bank = bankBytes()
  request.amount = event.params.assets
  globalState.withdrawalQueueCounter = globalState.withdrawalQueueCounter.plus(ONE)
  request.queuePosition = globalState.withdrawalQueueCounter
  request.requestedAt = event.block.timestamp
  request.isCancelled = false
  request.blockNumber = event.block.number
  request.transactionHash = event.transaction.hash
  request.save()

  user.openWithdrawalRequestId = requestId
  user.save()

  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.plus(event.params.assets)
  globalState.save()
}

export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.owner)

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

  if (globalState.totalPendingLargeWithdrawals.lt(event.params.assets)) {
    log.warning("totalPendingLargeWithdrawals underflow: {} < {}", [
      globalState.totalPendingLargeWithdrawals.toString(),
      event.params.assets.toString()
    ])
    globalState.totalPendingLargeWithdrawals = ZERO
  } else {
    globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.minus(event.params.assets)
  }
  globalState.save()
}

export function handleWithdrawalEjected(event: WithdrawalEjected): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const row = new WithdrawalEjectedLog(id)
  row.user = changetype<Bytes>(event.params.owner)
  row.bank = bankBytes()
  row.reason = event.params.reason
  row.blockNumber = event.block.number
  row.timestamp = event.block.timestamp
  row.transactionHash = event.transaction.hash
  row.save()
}

export function handleBetPlaced(event: BetPlaced): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.user)
  const isFirstBet = user.totalRouletteBets.equals(ZERO)

  // Ensure the Market exists for this bank — bets placed via the bank reference the market.
  const market = ensureMarketForBank(event.block.timestamp)

  const decoded = decodeWrapper(event.params.data, "(uint256[],uint256[],uint256[])")

  globalState.pendingBets = globalState.pendingBets.plus(event.params.amount)
  globalState.totalPlayAllTime = globalState.totalPlayAllTime.plus(event.params.amount)

  if (isFirstBet) {
    globalState.uniquePlayersCount = globalState.uniquePlayersCount.plus(ONE)
  }

  updateUserRouletteStats(event.params.user, event.params.amount, false, false, event.block.timestamp)
  updateUserLastActive(event.params.user, event.block.timestamp)

  if (decoded) {
    const s = decoded.toTuple()
    const amounts = s[0].toBigIntArray()
    const betTypes = s[1].toBigIntArray()
    const numbers = s[2].toBigIntArray()
    const amountsLength = amounts.length

    const roundId = bigintToBytes(event.params.roundId)
    let round = RouletteRound.load(roundId)
    if (round == null) {
      log.warning(
        "RouletteRound not yet present for bet; creating provisional round {} (BetPlaced before RoundCleaningCompleted)",
        [event.params.roundId.toString()]
      )
      round = createNewRouletteRound(event.params.roundId, event.block.timestamp)
      round.save()
    }

    const betEntityId = event.params.user.concat(roundId)
    const isNewBetForRound = RouletteBet.load(betEntityId) == null

    const previousMaxPayout = calculateMaxPayoutFromRoundComponents(round)

    for (let i = 0; i < amountsLength; i++) {
      const bet = processRouletteBet(event.params.user, amounts[i], betTypes[i], numbers[i], round, event)
      bet.market = market.id
      bet.save()
    }

    round.betCount = round.betCount.plus(BigInt.fromI32(amountsLength))

    if (isNewBetForRound) {
      round.uniqueBettors = round.uniqueBettors.plus(ONE)
      const betUser = getOrCreateUser(event.params.user)
      betUser.betCount = betUser.betCount.plus(ONE)
      betUser.save()
    }

    const currentMaxPayout = calculateMaxPayoutFromRoundComponents(round)
    const delta = currentMaxPayout.minus(previousMaxPayout)

    round.maxBetAmount = round.maxBetAmount.plus(delta)
    globalState.maxBetAmount = globalState.maxBetAmount.plus(delta)

    round.save()
  }

  const dailyStats = getOrCreateDailyStats(event.block.timestamp)
  dailyStats.volume = dailyStats.volume.plus(event.params.amount)
  dailyStats.betCount = dailyStats.betCount.plus(ONE)
  const isNewDaily = trackDailyUniquePlayer(event.block.timestamp, event.params.user.toHexString())
  if (isNewDaily) {
    dailyStats.uniquePlayers = dailyStats.uniquePlayers.plus(ONE)
  }
  dailyStats.save()

  const hourly = getOrCreateHourlySnapshot(event.block.timestamp)
  hourly.volume = hourly.volume.plus(event.params.amount)
  hourly.betCount = hourly.betCount.plus(ONE)
  const isNewHourly = trackHourlyUniquePlayer(event.block.timestamp, event.params.user.toHexString())
  if (isNewHourly) {
    hourly.uniquePlayers = hourly.uniquePlayers.plus(ONE)
  }
  hourly.save()

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
  updateUserSBRBBalance(event.params.from, event.params.value, false)
  updateUserSBRBBalance(event.params.to, event.params.value, true)
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

export function handleUpkeepRegistered(event: UpkeepRegistered): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new UpkeepRegistration(id)
  entity.registrationType = "LANE"
  entity.upkeepId = event.params.upkeepId
  entity.forwarder = event.params.forwarder
  entity.gasLimit = ZERO
  entity.linkAmount = event.params.amount
  entity.checkDataLength = event.params.lane
  entity.upkeepType = "payout"
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}
