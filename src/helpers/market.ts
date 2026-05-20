import { Address, BigInt, BigDecimal, Bytes, log } from "@graphprotocol/graph-ts"
import { Market, BankAddress, RouletteBet } from "../../generated/schema"
import { bigintToBytes } from "./bigintToBytes"
import { ZERO } from "./number"
import { ZERO_ADDRESS } from "./constant"

const EMPTY_BYTES = Bytes.fromHexString(ZERO_ADDRESS)

export function marketIdToString(marketId: i32): string {
  return marketId.toString()
}

export function marketRoundId(globalRoundId: BigInt, marketId: i32): Bytes {
  return bigintToBytes(globalRoundId).concat(bigintToBytes(BigInt.fromI32(marketId)))
}

export function getOrCreateMarket(
  marketId: i32,
  asset: Bytes,
  bank: Bytes,
  engine: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt
): Market {
  const id = marketIdToString(marketId)
  let market = Market.load(id)
  if (market == null) {
    market = new Market(id)
    market.marketId = marketId
    market.asset = asset
    market.bank = bank
    market.engine = engine
    market.totalAssets = ZERO
    market.totalShares = ZERO
    market.sharePrice = BigDecimal.fromString("1")
    market.stakerCount = ZERO
    market.totalDepositVolume = ZERO
    market.totalWithdrawVolume = ZERO
    market.pendingBets = ZERO
    market.maxBetAmount = ZERO
    market.minBet = ZERO
    market.active = true
    market.createdAt = timestamp
    market.createdAtBlock = blockNumber
  } else {
    if (asset.notEqual(Bytes.empty()) && market.asset.notEqual(asset)) {
      market.asset = asset
    }
    market.bank = bank
    if (engine.notEqual(Bytes.empty())) {
      market.engine = engine
    }
    market.active = true
    let bankLookup = BankAddress.load(bank)
    if (bankLookup == null) {
      bankLookup = new BankAddress(bank)
      bankLookup.market = id
      bankLookup.save()
    }
  }
  return market
}

export function getMarketByBank(bank: Address): Market | null {
  const lookup = BankAddress.load(changetype<Bytes>(bank))
  if (lookup == null) {
    return null
  }
  return Market.load(lookup.market)
}

const MAX_MARKET_SCAN: i32 = 32

export function findBetInGlobalRound(user: Bytes, globalRoundId: BigInt): RouletteBet | null {
  for (let mid: i32 = 1; mid <= MAX_MARKET_SCAN; mid++) {
    const bet = RouletteBet.load(user.concat(marketRoundId(globalRoundId, mid)))
    if (bet != null) {
      return bet
    }
  }
  return null
}

export function isKnownBank(address: Address): boolean {
  return BankAddress.load(changetype<Bytes>(address)) != null
}

export function loadMarketByBank(bank: Address): Market | null {
  const market = getMarketByBank(bank)
  if (market == null) {
    log.warning("Unknown bank address {}", [bank.toHexString()])
  }
  return market
}

export function getMarketById(marketId: i32): Market | null {
  return Market.load(marketIdToString(marketId))
}

export function requireMarket(marketId: i32): Market {
  const market = getMarketById(marketId)
  if (market == null) {
    // Provisional market before registry indexed (same-block ordering)
    const m = getOrCreateMarket(
      marketId,
      EMPTY_BYTES,
      EMPTY_BYTES,
      EMPTY_BYTES,
      ZERO,
      ZERO
    )
    m.save()
    return m
  }
  return market
}
