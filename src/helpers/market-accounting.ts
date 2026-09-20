import { BigInt, Bytes, Entity, Value, store } from "@graphprotocol/graph-ts"
import { Market } from "../../generated/schema"
import { ZERO } from "./number"

const FIELDS = ["volume", "betCount", "uniquePlayers", "revenue", "stakersRevenue", "jackpotFunded", "infraRevenue", "totalPayouts", "depositVolume", "withdrawalVolume", "roundsCompleted", "netRevenue", "losses"]

function add(row: Entity, key: string, amount: BigInt): void {
  const before = row.get(key)
  row.set(key, Value.fromBigInt((before == null ? ZERO : before.toBigInt()).plus(amount)))
}

/** Each call is one source event/category. Asset quantities are never price-normalized. */
export function recordMarketAccounting(
  market: Market, sourceId: string, timestamp: BigInt, block: BigInt,
  keys: string[], amounts: BigInt[], player: Bytes | null = null
): void {
  assert(keys.length == amounts.length, "Accounting delta length mismatch")
  const eventId = market.id + "-" + sourceId
  if (store.get("MarketAccountingEvent", eventId) != null) return
  const marker = new Entity()
  marker.set("id", Value.fromString(eventId))
  marker.set("market", Value.fromString(market.id))
  marker.set("timestamp", Value.fromBigInt(timestamp))
  marker.set("blockNumber", Value.fromBigInt(block))
  store.set("MarketAccountingEvent", eventId, marker)
  const day = timestamp.div(BigInt.fromI32(86400))
  const hour = timestamp.div(BigInt.fromI32(3600))
  const ids = [day.toString() + "-" + market.id, "hour-" + hour.toString() + "-" + market.id, "total-" + market.id]
  for (let i = 0; i < 3; i++) {
    const entityType = i == 0 ? "MarketDailyStat" : "MarketAccountingStat"
    let row = store.get(entityType, ids[i])
    if (row == null) {
      row = new Entity()
      row.set("id", Value.fromString(ids[i]))
      row.set("market", Value.fromString(market.id))
      row.set("date", Value.fromI32(i == 0 ? day.toI32() : i == 1 ? hour.toI32() : 0))
      row.set("timestamp", Value.fromBigInt(i == 0 ? day.times(BigInt.fromI32(86400)) : i == 1 ? hour.times(BigInt.fromI32(3600)) : ZERO))
      for (let k = 0; k < FIELDS.length; k++) row.set(FIELDS[k], Value.fromBigInt(ZERO))
    }
    for (let k = 0; k < keys.length; k++) add(row, keys[k], amounts[k])
    if (player !== null) {
      const playerId = ids[i] + "-" + player.toHexString()
      if (store.get("MarketAccountingPlayer", playerId) == null) {
        const participant = new Entity()
        participant.set("id", Value.fromString(playerId))
        store.set("MarketAccountingPlayer", playerId, participant)
        add(row, "uniquePlayers", BigInt.fromI32(1))
      }
    }
    row.set("calculationVersion", Value.fromI32(2))
    row.set("lastUpdatedBlock", Value.fromBigInt(block))
    row.set("lastUpdatedAt", Value.fromBigInt(timestamp))
    store.set(entityType, ids[i], row)
  }
}
