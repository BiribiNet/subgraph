import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
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
} from "../../generated/templates/BankVault/StakedBRB"
import { UpkeepRegistered } from "../../generated/templates/BankVault/MergedEvents"
import {
  StakedBRBDeposit,
  StakedBRBWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction,
  WithdrawalEjectedLog,
  TokenApproval,
  AdminRoleChange,
  ContractUpgrade,
  UpkeepRegistration,
} from "../../generated/schema"
import { updateUserStakingStats, updateUserSBRBBalance, getOrCreateUser, updateUserDepositCostBasis, updateUserWithdrawalCostBasis, updateUserLastActive } from "../helpers/user"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState, calculateAllAPYs, updateSharePrice, getOrCreateProtocolStats, calculateSharePrice, syncVaultState } from "../helpers/globalState"
import { ONE, ZERO } from "../helpers/number"
import { getOrCreateDailyStats, trackDailyUniquePlayer, getOrCreateHourlySnapshot, trackHourlyUniquePlayer } from "../helpers/aggregation"
import { loadMarketByBank } from "../helpers/market"

export function handleDeposit(event: Deposit): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }

  const globalState = getOrCreateGlobalState()

  const depositId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const deposit = new StakedBRBDeposit(depositId)
  deposit.market = market.id
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
  market.totalAssets = market.totalAssets.plus(event.params.assets)
  market.totalShares = market.totalShares.plus(event.params.shares)
  market.totalDepositVolume = market.totalDepositVolume.plus(event.params.assets)
  market.sharePrice = calculateSharePrice(market.totalAssets, market.totalShares)

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

export function handleWithdraw(event: Withdraw): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }

  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.owner)

  // Create withdrawal entity
  const withdrawalId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const withdrawal = new StakedBRBWithdrawal(withdrawalId)
  withdrawal.market = market.id
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
  market.totalAssets = market.totalAssets.minus(event.params.assets)
  market.totalShares = market.totalShares.minus(event.params.shares)
  market.totalWithdrawVolume = market.totalWithdrawVolume.plus(event.params.assets)
  market.sharePrice = calculateSharePrice(market.totalAssets, market.totalShares)

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

  market.save()
  globalState.save()

  const vaultW = syncVaultState(globalState, event.block.timestamp)
  vaultW.save()
}

export function handleWithdrawalRequested(event: WithdrawalRequested): void {
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.owner)

  const requestId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.owner
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
  row.reason = event.params.reason
  row.blockNumber = event.block.number
  row.timestamp = event.block.timestamp
  row.transactionHash = event.transaction.hash
  row.save()
}

export function handleBetPlaced(_event: BetPlaced): void {
  // Indexed via RouletteEngine.BetRecorded (includes marketId). Vault BetPlaced is intentionally skipped to avoid double-counting volume and bets.
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

export function handleUpkeepRegistered(event: UpkeepRegistered): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new UpkeepRegistration(id)
  entity.registrationType = "LANE"
  entity.upkeepId = event.params.upkeepId
  entity.forwarder = event.params.forwarder
  entity.gasLimit = BigInt.fromI32(0)
  entity.linkAmount = event.params.amount
  entity.checkDataLength = event.params.lane
  entity.upkeepType = "payout"
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

