import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  Deposit,
  Withdraw,
  Transfer as VaultShareTransfer,
  WithdrawalRequested,
  WithdrawalProcessed,
  BetPlaced,
  Approval,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
  BetsReleased,
  SideBetStakeLocked,
  PayoutBatchProcessed,
  FundsTransferred,
  MinBetUpdated,
  SideBetControllerUpdated,
} from "../../generated/templates/BankVault/BankVault4626"
import { UpkeepRegistered } from "../../generated/templates/BankVault/MergedEvents"
import {
  VaultDeposit,
  VaultWithdrawal,
  LargeWithdrawalRequest,
  WithdrawTransaction,
  TokenApproval,
  ContractUpgrade,
  UpkeepRegistration,
  Market,
  GlobalState,
} from "../../generated/schema"
import { updateUserStakingStats, updateUserSBRBBalance, getOrCreateUser, updateUserDepositCostBasis, updateUserWithdrawalCostBasis, updateUserLastActive } from "../helpers/user"
import { bigintToBytes } from "../helpers/bigintToBytes"
import {
  ROLE_CONTRACT_BANK_VAULT,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { calculateMarketAPYs } from "../helpers/marketApy"
import { addVaultDepositTotals, subtractVaultAssetsTotals } from "../helpers/vaultClassTotals"
import { BPS_DENOMINATOR, ONE, ZERO } from "../helpers/number"
import { getOrCreateDailyStats, getOrCreateHourlySnapshot } from "../helpers/aggregation"
import { loadMarketByBank } from "../helpers/market"
import { recordTxDepositToBank } from "../helpers/tx-activity"
import { releasePendingBets } from "../helpers/vault-liquidity"
import {
  addGrossVaultBalance,
  addLockedBetLiquidity,
  setLockedBetLiquidity,
  subtractGrossVaultBalance,
  syncMarketTotalAssets,
} from "../helpers/vault-ledger"
import { BRB_TOKEN_ADDRESS } from "../helpers/constant"
import {
  recordUserMarketStake,
  recordUserMarketSbrbShares,
} from "../helpers/user-market-stats"

function undoBrbDonationIfNeeded(market: Market, globalState: GlobalState, assets: BigInt): void {
  if (!Address.fromBytes(market.asset).equals(BRB_TOKEN_ADDRESS)) {
    return
  }
  let grossUndo = ZERO
  if (market.brbDonations.ge(assets)) {
    market.brbDonations = market.brbDonations.minus(assets)
    grossUndo = assets
  } else if (market.brbDonations.gt(ZERO)) {
    grossUndo = market.brbDonations
    market.brbDonations = ZERO
  }
  if (grossUndo.gt(ZERO)) {
    subtractGrossVaultBalance(market, grossUndo)
  }
  if (globalState.totalTransfersToPool.ge(assets)) {
    globalState.totalTransfersToPool = globalState.totalTransfersToPool.minus(assets)
  } else {
    globalState.totalTransfersToPool = ZERO
  }
}

export function handleDeposit(event: Deposit): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }

  const globalState = getOrCreateGlobalState()

  recordTxDepositToBank(event.transaction.hash, event.params.assets)
  undoBrbDonationIfNeeded(market, globalState, event.params.assets)

  const depositId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const deposit = new VaultDeposit(depositId)
  deposit.market = market.id
  deposit.user = event.params.owner
  deposit.assets = event.params.assets
  deposit.shares = event.params.shares
  deposit.blockNumber = event.block.number
  deposit.timestamp = event.block.timestamp
  deposit.transactionHash = event.transaction.hash
  deposit.save()

  updateUserStakingStats(event.params.owner, event.params.assets, true, event.block.timestamp)
  recordUserMarketStake(event.params.owner, market, event.params.assets, true, event.block.timestamp)
  updateUserLastActive(event.params.owner, event.block.timestamp)
  updateUserDepositCostBasis(event.params.owner, event.params.assets, event.params.shares)

  addVaultDepositTotals(market, globalState, event.params.assets)
  addGrossVaultBalance(market, event.params.assets)
  market.totalShares = market.totalShares.plus(event.params.shares)
  market.totalDepositVolume = market.totalDepositVolume.plus(event.params.assets)

  calculateMarketAPYs(market, event.block.timestamp, event.block.number)

  const dailyStatsDeposit = getOrCreateDailyStats(event.block.timestamp)
  dailyStatsDeposit.depositVolume = dailyStatsDeposit.depositVolume.plus(event.params.assets)
  dailyStatsDeposit.depositCount = dailyStatsDeposit.depositCount.plus(BigInt.fromI32(1))
  dailyStatsDeposit.vaultSharePrice = market.sharePrice
  dailyStatsDeposit.save()

  const hourlyDeposit = getOrCreateHourlySnapshot(event.block.timestamp)
  hourlyDeposit.depositVolume = hourlyDeposit.depositVolume.plus(event.params.assets)
  hourlyDeposit.save()

  globalState.totalDeposited = globalState.totalDeposited.plus(event.params.assets)

  market.save()
  globalState.save()
}

/** ERC-4626 Withdraw never fires on-chain — vault uses WithdrawalRequested + WithdrawalProcessed. */
export function handleWithdraw(_event: Withdraw): void {}

export function handleWithdrawalRequested(event: WithdrawalRequested): void {
  const market = loadMarketByBank(event.address)
  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.owner)

  let estimatedAssets = ZERO
  const bps = BigInt.fromI32(event.params.bps)
  let sharesHeld = user.sbrbBalance
  if (sharesHeld.equals(ZERO)) {
    sharesHeld = user.cumulativeDepositShares
  }
  if (
    market != null &&
    !sharesHeld.equals(ZERO) &&
    !market.totalShares.equals(ZERO) &&
    bps.gt(ZERO)
  ) {
    const sharesRequested = sharesHeld.times(bps).div(BPS_DENOMINATOR)
    estimatedAssets = sharesRequested
      .times(market.totalAssets)
      .div(market.totalShares)
  }

  const requestId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const request = new LargeWithdrawalRequest(requestId)
  request.user = event.params.owner
  request.amount = estimatedAssets
  if (market != null) {
    request.market = market.id
  }
  request.bank = event.address
  globalState.withdrawalQueueCounter = globalState.withdrawalQueueCounter.plus(ONE)
  request.queuePosition = globalState.withdrawalQueueCounter
  request.requestedAt = event.block.timestamp
  request.isCancelled = false
  request.blockNumber = event.block.number
  request.transactionHash = event.transaction.hash
  request.save()

  user.openWithdrawalRequestId = requestId
  user.save()

  globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.plus(estimatedAssets)
  globalState.save()
}

export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }

  const globalState = getOrCreateGlobalState()
  const user = getOrCreateUser(event.params.owner)
  const assetsPaid = event.params.assetsPaid
  const sharesBurned = event.params.sharesBurned

  // Fallback decrement when the request row is missing (e.g. pre-migration
  // rows): keep the clamped assetsPaid subtraction.
  let pendingDecrement = assetsPaid

  const openReqId = user.openWithdrawalRequestId
  if (openReqId) {
    const req = LargeWithdrawalRequest.load(openReqId)
    if (req) {
      // Subtract exactly what handleWithdrawalRequested added (the estimate) —
      // assetsPaid is 0 for cancellations and can differ from the estimate for
      // real processing, both of which permanently drift the aggregate.
      pendingDecrement = req.amount
      req.processedAt = event.block.timestamp
      if (assetsPaid.equals(ZERO) && sharesBurned.equals(ZERO)) {
        // cancelWithdrawal() emits WithdrawalProcessed(owner, bps, receiver, 0, 0):
        // nothing was paid out — the request left the queue as a cancellation.
        // processedAt doubles as "when the request was closed on-chain" (there
        // is no cancelledAt field); consumers check isCancelled first.
        req.isCancelled = true
      }
      req.save()
    }
    user.openWithdrawalRequestId = null
    user.save()
  }

  if (globalState.totalPendingLargeWithdrawals.lt(pendingDecrement)) {
    globalState.totalPendingLargeWithdrawals = ZERO
  } else {
    globalState.totalPendingLargeWithdrawals = globalState.totalPendingLargeWithdrawals.minus(pendingDecrement)
  }

  if (assetsPaid.gt(ZERO) || sharesBurned.gt(ZERO)) {
    const withdrawalId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
    const withdrawal = new VaultWithdrawal(withdrawalId)
    withdrawal.market = market.id
    withdrawal.user = event.params.owner
    withdrawal.assets = assetsPaid
    withdrawal.shares = sharesBurned
    withdrawal.blockNumber = event.block.number
    withdrawal.timestamp = event.block.timestamp
    withdrawal.transactionHash = event.transaction.hash
    withdrawal.save()

    updateUserStakingStats(event.params.owner, assetsPaid, false, event.block.timestamp)
    recordUserMarketStake(event.params.owner, market, assetsPaid, false, event.block.timestamp)
    updateUserLastActive(event.params.owner, event.block.timestamp)
    updateUserWithdrawalCostBasis(event.params.owner, sharesBurned)

    let wt = WithdrawTransaction.load(event.transaction.hash)
    if (wt == null) {
      wt = new WithdrawTransaction(event.transaction.hash)
      wt.user = event.params.owner
      wt.blockNumber = event.block.number
      wt.timestamp = event.block.timestamp
      wt.save()
    }

    subtractGrossVaultBalance(market, assetsPaid)
    if (market.totalShares.ge(sharesBurned)) {
      market.totalShares = market.totalShares.minus(sharesBurned)
    } else {
      market.totalShares = ZERO
    }
    syncMarketTotalAssets(market)
    market.totalWithdrawVolume = market.totalWithdrawVolume.plus(assetsPaid)

    subtractVaultAssetsTotals(market, globalState, assetsPaid)
    calculateMarketAPYs(market, event.block.timestamp, event.block.number)

    const dailyStatsWithdraw = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsWithdraw.withdrawalVolume = dailyStatsWithdraw.withdrawalVolume.plus(assetsPaid)
    dailyStatsWithdraw.withdrawalCount = dailyStatsWithdraw.withdrawalCount.plus(BigInt.fromI32(1))
    dailyStatsWithdraw.vaultSharePrice = market.sharePrice
    dailyStatsWithdraw.save()

    const hourlyWithdraw = getOrCreateHourlySnapshot(event.block.timestamp)
    hourlyWithdraw.withdrawalVolume = hourlyWithdraw.withdrawalVolume.plus(assetsPaid)
    hourlyWithdraw.save()

    globalState.totalWithdrawn = globalState.totalWithdrawn.plus(assetsPaid)

    market.save()
  }

  globalState.save()
}

export function handleBetsReleased(event: BetsReleased): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  releasePendingBets(market, event.params.amount)
  setLockedBetLiquidity(market, event.params.newLockedTotal)
  calculateMarketAPYs(market, event.block.timestamp, event.block.number)
  market.save()
}

export function handleSideBetStakeLocked(event: SideBetStakeLocked): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  addGrossVaultBalance(market, event.params.stake)
  setLockedBetLiquidity(market, event.params.newLockedTotal)
  market.lockedSideBetLiquidity = market.lockedSideBetLiquidity.plus(event.params.payoutReserve)
  calculateMarketAPYs(market, event.block.timestamp, event.block.number)
  market.save()
}

export function handleBetPlaced(event: BetPlaced): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  addGrossVaultBalance(market, event.params.amount)
  addLockedBetLiquidity(market, event.params.amount)
  // totalAssets-neutral (gross and locked move together) — APY recompute deferred to BetsReleased
  market.save()
}

export function handlePayoutBatchProcessed(event: PayoutBatchProcessed): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  subtractGrossVaultBalance(market, event.params.totalPaid)
  calculateMarketAPYs(market, event.block.timestamp, event.block.number)
  market.save()
}

export function handleFundsTransferred(event: FundsTransferred): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  subtractGrossVaultBalance(market, event.params.amount)
  calculateMarketAPYs(market, event.block.timestamp, event.block.number)
  market.save()
}

export function handleMinBetUpdated(event: MinBetUpdated): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  market.minBet = event.params.newMinBet
  market.save()
}

export function handleSideBetControllerUpdated(event: SideBetControllerUpdated): void {
  const market = loadMarketByBank(event.address)
  if (market == null) {
    return
  }
  market.sideBetController = event.params.newController
  market.save()
}

export function handleTransfer(event: VaultShareTransfer): void {
  const market = loadMarketByBank(event.address)
  if (market != null) {
    recordUserMarketSbrbShares(event.params.from, market, event.params.value, false)
    recordUserMarketSbrbShares(event.params.to, market, event.params.value, true)
  }
  updateUserSBRBBalance(event.params.from, event.params.value, false, market)
  updateUserSBRBBalance(event.params.to, event.params.value, true, market)
}

export function handleApproval(event: Approval): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const approval = new TokenApproval(id)
  approval.token = "vault"
  approval.owner = event.params.owner
  approval.spender = event.params.spender
  approval.value = event.params.value
  approval.blockNumber = event.block.number
  approval.timestamp = event.block.timestamp
  approval.transactionHash = event.transaction.hash
  approval.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_BANK_VAULT,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleRevoked(event: RoleRevoked): void {
  revokeRoleHolder(
    event.address,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleAdminChanged(event: RoleAdminChanged): void {
  updateRoleAdmin(
    event.address,
    ROLE_CONTRACT_BANK_VAULT,
    event.params.role,
    event.params.newAdminRole
  )
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
