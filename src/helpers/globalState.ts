import { Bytes, BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { GlobalState } from "../../generated/schema"
import { ZERO } from "./number"
import { getOrCreateGlobalRound } from "./globalRound"

const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001")

export function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    const initialRound = getOrCreateGlobalRound(BigInt.fromI32(1), ZERO)
    initialRound.save()
    globalState.currentGlobalRound = initialRound.id
    globalState.currentRoundNumber = BigInt.fromI32(1)
    globalState.lastRoundStartTime = ZERO
    globalState.lastRoundPaid = ZERO
    globalState.currentJackpot = ZERO
    globalState.stableVaultTotalAssets = ZERO
    globalState.brbVaultTotalAssets = ZERO
    globalState.stableVaultTotalDeposits = ZERO
    globalState.brbVaultTotalDeposits = ZERO
    globalState.lastRoundResolved = ZERO
    globalState.roundTransitionInProgress = false
    globalState.largeWithdrawalBatchSize = BigInt.fromI32(5)
    globalState.maxQueueLength = BigInt.fromI32(100)
    globalState.totalPendingLargeWithdrawals = ZERO
    globalState.withdrawalQueueCounter = ZERO
    globalState.totalTransfersToPool = ZERO
    globalState.totalWagered = ZERO
    globalState.totalBets = ZERO
    globalState.totalRounds = ZERO
    globalState.totalPlayers = ZERO
    globalState.totalBurned = ZERO
    globalState.totalJackpotsPaid = ZERO
    globalState.totalStakerRevenue = ZERO
    globalState.brbTotalSupply = ZERO
    globalState.totalPayouts = ZERO
    globalState.totalDeposited = ZERO
    globalState.totalWithdrawn = ZERO
    globalState.roundDuration = ZERO
  }
  return globalState
}

// BankVault4626 share tokens are minted in 18 decimals on-chain for every
// market, regardless of the underlying asset's decimals.
const SHARE_TOKEN_DECIMALS = 18

// Returns the display-ready "assets per whole share" price: the value of one
// whole share (10^18 raw shares) expressed in whole asset units. Because shares
// are 18-dec and the asset can be fewer (USDC = 6), the raw totalAssets /
// totalShares ratio must be rescaled by 10^(18 - assetDecimals); otherwise a
// 1:1 USDC vault reads as ~1e-12 instead of 1.0. No-op for 18-dec assets (BRB).
export function calculateSharePrice(
  totalAssets: BigInt,
  totalShares: BigInt,
  assetDecimals: i32
): BigDecimal {
  if (totalShares.gt(ZERO)) {
    const shareUnit = BigInt.fromI32(10).pow(u8(SHARE_TOKEN_DECIMALS))
    const assetUnit = BigInt.fromI32(10).pow(u8(assetDecimals))
    return totalAssets
      .times(shareUnit)
      .toBigDecimal()
      .div(totalShares.toBigDecimal())
      .div(assetUnit.toBigDecimal())
  }
  return BigDecimal.fromString("1")
}

export { GLOBAL_STATE_ID }
