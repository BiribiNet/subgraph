import { BigInt, log } from "@graphprotocol/graph-ts"

import {
  FundingReconciled,
  FundingRetryScheduled,
  FundingRetryReset,
  FundingImported,
  ColdSlippageBpsUpdated,
  FundFromMarketSkipped,
  FundedFromMarket,
  PendingBrbDistributed,
  PairObservationUpdated,
  SlippageBpsUpdated,
  SwapAssetBpsUpdated,
  TreasuryBrbSplitUpdated,
  TwapWindowUpdated,
  JackpotBurnFailed,
  JackpotTreasuryTransferFailed,
  TokenSwept,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
} from "../../generated/BRBJackpotFunder/BRBJackpotFunder"
import { FundingInputImport, FundingVaultBalance, FundingLedgerSnapshot, JackpotBuy, JackpotFundingSkip, JackpotFunderIncident, JackpotFundingRecovery, PendingBrbBurn, BRBBurn, BRBTransfer } from "../../generated/schema"

export function handleFundingImported(event: FundingImported): void {
  const row = new FundingInputImport(event.transaction.hash.concat(bigintToBytes(event.logIndex)))
  row.funder = event.address
  row.marketId = event.params.marketId.toI32()
  row.asset = event.params.asset
  row.amount = event.params.amount
  row.sourceTransaction = event.params.sourceTransaction
  row.transactionHash = event.transaction.hash
  row.timestamp = event.block.timestamp
  row.save()
}

export function handleFundingReconciled(event: FundingReconciled): void {
  const id = event.address.toHexString() + "-" + event.params.marketId.toString()
  let vault = FundingVaultBalance.load(id)
  if (vault == null) {
    vault = new FundingVaultBalance(id)
    vault.failures = 0
    vault.nextAttemptAt = BigInt.fromI32(0)
    vault.stopped = false
  }
  vault.funder = event.address
  vault.marketId = event.params.marketId.toI32()
  vault.asset = event.params.asset
  vault.credited = event.params.credited
  vault.processed = event.params.processed
  vault.queued = event.params.queued
  vault.brbProduced = event.params.brbProduced
  vault.treasuryPaid = event.params.treasuryPaid
  vault.burned = event.params.burned
  vault.pendingTreasury = event.params.pendingTreasury
  vault.pendingBurn = event.params.pendingBurn
  vault.balanced = vault.credited.equals(vault.processed.plus(vault.queued)) &&
    vault.brbProduced.equals(vault.treasuryPaid.plus(vault.burned).plus(vault.pendingTreasury).plus(vault.pendingBurn))
  vault.blockNumber = event.block.number
  vault.timestamp = event.block.timestamp
  vault.transactionHash = event.transaction.hash
  vault.save()
  const snapshot = new FundingLedgerSnapshot(event.transaction.hash.concat(bigintToBytes(event.logIndex)))
  snapshot.vault = id
  snapshot.credited = vault.credited
  snapshot.processed = vault.processed
  snapshot.queued = vault.queued
  snapshot.brbProduced = vault.brbProduced
  snapshot.treasuryPaid = vault.treasuryPaid
  snapshot.burned = vault.burned
  snapshot.pendingTreasury = vault.pendingTreasury
  snapshot.pendingBurn = vault.pendingBurn
  snapshot.balanced = vault.balanced
  snapshot.blockNumber = event.block.number
  snapshot.timestamp = event.block.timestamp
  snapshot.transactionHash = event.transaction.hash
  snapshot.save()
}

export function handleFundingRetryScheduled(event: FundingRetryScheduled): void {
  const id = event.address.toHexString() + "-" + event.params.marketId.toString()
  const vault = FundingVaultBalance.load(id)
  if (vault == null) return
  vault.failures = event.params.failures
  vault.nextAttemptAt = event.params.nextAttemptAt
  vault.stopped = event.params.stopped
  vault.save()
}

export function handleFundingRetryReset(event: FundingRetryReset): void {
  const id = event.address.toHexString() + "-" + event.params.marketId.toString()
  const vault = FundingVaultBalance.load(id)
  if (vault == null) return
  vault.failures = 0
  vault.nextAttemptAt = BigInt.fromI32(0)
  vault.stopped = false
  vault.save()
}

// JackpotFunderIncident.kind enum values (must match schema enum JackpotFunderIncidentKind).
const INCIDENT_BURN_FAILED = "BURN_FAILED"
const INCIDENT_TREASURY_TRANSFER_FAILED = "TREASURY_TRANSFER_FAILED"
const INCIDENT_TOKEN_SWEPT = "TOKEN_SWEPT"
import { ERC20 } from "../../generated/BRBJackpotFunder/ERC20"
import { BRB_TOKEN_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateJackpotFunderConfig } from "../helpers/jackpot-funder"
import { getMarketById } from "../helpers/market"
import {
  ROLE_CONTRACT_JACKPOT_FUNDER,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"

// NOTE: BrbRatioUpdated was removed from the funder in the Uniswap V2 TWAP rework
// (the per-market fixed ratio setter is gone — BRB price now derives from the
// on-chain TWAP), so no handler is wired for it. The TWAP config setters below
// keep the JackpotFunderConfig singleton in sync with the on-chain pricing
// parameters (cold slippage + TWAP window).

export function handleFundedFromMarket(event: FundedFromMarket): void {
  getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  const marketIdInt32 = event.params.marketId.toI32()
  const market = getMarketById(marketIdInt32)
  if (market == null) {
    log.warning("FundedFromMarket: Market {} not found", [marketIdInt32.toString()])
    return
  }
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const buy = new JackpotBuy(id)
  buy.funder = event.address
  buy.market = market.id
  buy.asset = event.params.asset
  buy.assetSwapped = event.params.assetSwapped
  buy.brbOut = event.params.brbOut
  buy.brbToTreasury = event.params.brbToTreasury
  buy.brbBurned = event.params.brbBurned
  buy.timestamp = event.block.timestamp
  buy.blockNumber = event.block.number
  buy.transactionHash = event.transaction.hash
  buy.save()
}

export function handlePendingBrbDistributed(event: PendingBrbDistributed): void {
  const recovery = new JackpotFundingRecovery(event.transaction.hash.concat(bigintToBytes(event.logIndex)))
  recovery.funder = event.address
  const market = getMarketById(event.params.marketId.toI32())
  if (market != null) recovery.market = market.id
  recovery.treasuryAmount = event.params.treasuryAmount
  recovery.burnedAmount = event.params.burnedAmount
  recovery.timestamp = event.block.timestamp
  recovery.transactionHash = event.transaction.hash
  recovery.save()
  // This burn repays an older liability. Do not attribute it to today's roulette round.
  if (event.params.burnedAmount.gt(BigInt.fromI32(0))) {
    const pending = PendingBrbBurn.load(event.transaction.hash)
    if (pending != null && pending.cursor < pending.burnIds.length) {
      // burn() emits immediately before this event. Earlier unrelated burns must stay intact.
      const ids = pending.burnIds
      const lastId = ids[ids.length - 1]
      const burn = BRBBurn.load(lastId)
      const transfer = BRBTransfer.load(lastId)
      if (burn != null && transfer != null && transfer.from.equals(event.address)
        && burn.amount.equals(event.params.burnedAmount)) {
        ids.pop()
        pending.burnIds = ids
        pending.save()
      }
    }
  }
}

export function handleFundFromMarketSkipped(event: FundFromMarketSkipped): void {
  const marketIdInt32 = event.params.marketId.toI32()
  const market = getMarketById(marketIdInt32)
  if (market == null) {
    log.warning("FundFromMarketSkipped: Market {} not found", [marketIdInt32.toString()])
    return
  }
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const skip = new JackpotFundingSkip(id)
  skip.funder = event.address
  skip.market = market.id
  skip.asset = event.params.asset
  skip.reason = event.params.reason
  skip.timestamp = event.block.timestamp
  skip.save()
}

// Non-reverting settlement incidents. The funder emits these instead of
// reverting so a failed burn/transfer never bricks round payout. We record each
// as an immutable log; the market is resolved best-effort (null if unknown).
export function handleJackpotBurnFailed(event: JackpotBurnFailed): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const incident = new JackpotFunderIncident(id)
  incident.funder = event.address
  incident.asset = BRB_TOKEN_ADDRESS
  incident.assetSymbol = "BRB"
  incident.assetDecimals = 18
  incident.kind = INCIDENT_BURN_FAILED
  const market = getMarketById(event.params.marketId.toI32())
  if (market != null) {
    incident.market = market.id
  }
  incident.amount = event.params.amount
  incident.timestamp = event.block.timestamp
  incident.blockNumber = event.block.number
  incident.transactionHash = event.transaction.hash
  incident.save()
}

export function handleJackpotTreasuryTransferFailed(event: JackpotTreasuryTransferFailed): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const incident = new JackpotFunderIncident(id)
  incident.funder = event.address
  incident.kind = INCIDENT_TREASURY_TRANSFER_FAILED
  const market = getMarketById(event.params.marketId.toI32())
  if (market != null) {
    incident.market = market.id
  }
  incident.asset = BRB_TOKEN_ADDRESS
  incident.assetSymbol = "BRB"
  incident.assetDecimals = 18
  incident.to = event.params.treasury
  incident.amount = event.params.amount
  incident.timestamp = event.block.timestamp
  incident.blockNumber = event.block.number
  incident.transactionHash = event.transaction.hash
  incident.save()
}

export function handleTokenSwept(event: TokenSwept): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const incident = new JackpotFunderIncident(id)
  incident.funder = event.address
  incident.kind = INCIDENT_TOKEN_SWEPT
  incident.asset = event.params.asset
  const token = ERC20.bind(event.params.asset)
  const symbol = token.try_symbol()
  const decimals = token.try_decimals()
  if (!symbol.reverted) incident.assetSymbol = symbol.value
  if (!decimals.reverted) incident.assetDecimals = decimals.value
  incident.to = event.params.to
  incident.amount = event.params.amount
  incident.timestamp = event.block.timestamp
  incident.blockNumber = event.block.number
  incident.transactionHash = event.transaction.hash
  incident.save()
}

export function handleSwapAssetBpsUpdated(event: SwapAssetBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.swapAssetTotalBps = event.params.totalBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleTreasuryBrbSplitUpdated(event: TreasuryBrbSplitUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.treasuryBrbNumerator = event.params.numerator
  cfg.treasuryBrbDenominator = event.params.denominator
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleSlippageBpsUpdated(event: SlippageBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.slippageBps = event.params.slippageBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleColdSlippageBpsUpdated(event: ColdSlippageBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.coldSlippageBps = event.params.coldSlippageBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleTwapWindowUpdated(event: TwapWindowUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.twapWindowSeconds = event.params.twapWindowSeconds
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

// PairObservationUpdated fires whenever the funder refreshes its TWAP observation
// for a BRB/<asset> pair. We only bump lastUpdatedAt on the config singleton — the
// raw observation history is not needed by any consumer yet.
export function handlePairObservationUpdated(event: PairObservationUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp, event.address)
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_JACKPOT_FUNDER,
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
    ROLE_CONTRACT_JACKPOT_FUNDER,
    event.params.role,
    event.params.newAdminRole
  )
}

import { FundingAttemptStarted, FundingAttemptCompleted } from "../../generated/BRBJackpotFunder/BRBJackpotFunder"
import { ProtocolFundingAttempt } from "../../generated/schema"

export function handleFundingAttemptStarted(event: FundingAttemptStarted): void {
  const row = new ProtocolFundingAttempt(event.address.toHexString() + "-" + event.params.attemptId.toString())
  row.funder = event.address
  row.attemptId = event.params.attemptId
  row.marketId = event.params.marketId.toI32()
  row.asset = event.params.asset
  row.inputBalance = event.params.inputBalance
  row.brbBalance = event.params.brbBalance
  row.transactionHash = event.transaction.hash
  row.timestamp = event.block.timestamp
  row.completed = false
  row.save()
}
export function handleFundingAttemptCompleted(event: FundingAttemptCompleted): void {
  const id = event.address.toHexString() + "-" + event.params.attemptId.toString()
  let row = ProtocolFundingAttempt.load(id)
  if (row == null) {
    row = new ProtocolFundingAttempt(id)
    row.funder = event.address
    row.attemptId = event.params.attemptId
    row.transactionHash = event.transaction.hash
    row.timestamp = event.block.timestamp
  }
  row.remainingInput = event.params.remainingInput
  row.remainingBrb = event.params.remainingBrb
  row.completed = true
  row.save()
}
