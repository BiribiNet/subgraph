import { Address, DataSourceContext, dataSource } from "@graphprotocol/graph-ts"

// Mainnet preparation replaces only this selector with manifest-derived topic-filtered templates.
// Unknown/future pairs always retain the generic listener; registration remains authoritative.
export function marketAssetTemplate(asset: Address, bank: Address): string {
  return "MarketAsset"
}

export function createMarketAssetSource(asset: Address, bank: Address): void {
  const context = new DataSourceContext()
  context.setBytes("bank", bank)
  dataSource.createWithContext(marketAssetTemplate(asset, bank), [asset.toHexString()], context)
}
