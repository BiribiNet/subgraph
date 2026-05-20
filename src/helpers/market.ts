import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { BankIndex, Market } from "../../generated/schema"
import { BankVault4626 } from "../../generated/RouletteEngine/BankVault4626"
import { ERC20 } from "../../generated/RouletteEngine/ERC20"
import { bigintToBytes } from "./bigintToBytes"
import { ZERO } from "./number"

function marketKey(marketId: BigInt): Bytes {
  return bigintToBytes(marketId)
}

export function marketRoundKey(marketId: BigInt, globalRoundId: BigInt): Bytes {
  return bigintToBytes(marketId).concat(bigintToBytes(globalRoundId))
}

export function getOrCreateMarketByIdWithBank(marketId: BigInt, bank: Address, timestamp: BigInt): Market {
  const id = marketKey(marketId)
  let market = Market.load(id)
  if (market != null) {
    return market
  }
  market = new Market(id)
  market.marketId = marketId
  market.bank = bank
  market.createdAt = timestamp
  market.totalAssets = ZERO
  market.totalShares = ZERO

  hydrateMarketMetadata(market, bank)
  market.save()

  upsertBankIndex(bank, market)
  return market
}

export function getOrCreateMarketByBank(bank: Address, timestamp: BigInt): Market {
  let index = BankIndex.load(bank)
  if (index != null) {
    const existing = Market.load(index.market)
    if (existing != null) {
      return existing
    }
  }
  const vault = BankVault4626.bind(bank)
  const tryMarketId = vault.try_marketId()
  const marketId = tryMarketId.reverted ? ZERO : tryMarketId.value
  return getOrCreateMarketByIdWithBank(marketId, bank, timestamp)
}

function hydrateMarketMetadata(market: Market, bank: Address): void {
  const vault = BankVault4626.bind(bank)

  const tryAsset = vault.try_asset()
  if (!tryAsset.reverted) {
    market.asset = tryAsset.value
  } else {
    market.asset = Address.zero()
    log.warning("BankVault4626.asset() reverted for bank {}", [bank.toHexString()])
  }

  const tryShareName = vault.try_name()
  market.shareName = tryShareName.reverted ? "" : tryShareName.value

  const tryShareSymbol = vault.try_symbol()
  market.shareSymbol = tryShareSymbol.reverted ? "" : tryShareSymbol.value

  if (!tryAsset.reverted) {
    const asset = ERC20.bind(tryAsset.value)
    const tryAssetSymbol = asset.try_symbol()
    market.assetSymbol = tryAssetSymbol.reverted ? "" : tryAssetSymbol.value
    const tryAssetDecimals = asset.try_decimals()
    market.assetDecimals = tryAssetDecimals.reverted ? 18 : tryAssetDecimals.value
  } else {
    market.assetSymbol = ""
    market.assetDecimals = 18
  }
}

export function upsertBankIndex(bank: Address, market: Market): void {
  let index = BankIndex.load(bank)
  if (index == null) {
    index = new BankIndex(bank)
  }
  index.market = market.id
  index.save()
}

export function loadMarketByBank(bank: Bytes): Market | null {
  const index = BankIndex.load(bank)
  if (index == null) {
    return null
  }
  return Market.load(index.market)
}
