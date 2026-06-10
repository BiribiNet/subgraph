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

// BankVault4626 mints shares with the ERC-4626 anti-inflation decimal offset:
// share decimals = asset decimals + 6. Verified on-chain on Arbitrum Sepolia
// (`decimals()`): USDC bank 0xb4Ec1620… = 12, DAI bank 0x823AE56D… = 24,
// BRB bank 0xcF6759fD… = 24. Shares are NOT a fixed 18 decimals.
const SHARE_DECIMALS_OFFSET = 6

// Returns the display-ready "assets per whole share" price: the value of one
// whole share (10^(assetDecimals + 6) raw shares) expressed in whole asset
// units. A freshly seeded 1:1 vault reads exactly 1.0 for every market.
export function calculateSharePrice(
  totalAssets: BigInt,
  totalShares: BigInt,
  assetDecimals: i32
): BigDecimal {
  if (totalShares.gt(ZERO)) {
    const shareUnit = BigInt.fromI32(10).pow(u8(assetDecimals + SHARE_DECIMALS_OFFSET))
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
