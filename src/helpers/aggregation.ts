import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { DailyStats, DailyPlayer, HourlyVolumeSnapshot, HourlyPlayer } from "../../generated/schema"
import { ZERO } from "./number"

const SECONDS_PER_DAY = BigInt.fromI32(86400)
const SECONDS_PER_HOUR = BigInt.fromI32(3600)

export function getOrCreateDailyStats(timestamp: BigInt): DailyStats {
  const dayNumber = timestamp.div(SECONDS_PER_DAY)
  const id = dayNumber.toString()
  let stats = DailyStats.load(id)
  if (stats == null) {
    stats = new DailyStats(id)
    stats.date = dayNumber.toI32()
    stats.volume = ZERO
    stats.betCount = ZERO
    stats.uniquePlayers = ZERO
    stats.revenue = ZERO
    stats.burnAmount = ZERO
    stats.jackpotFunded = ZERO
    stats.vaultSharePrice = BigDecimal.fromString("0")
    stats.jackpotPool = ZERO
    stats.roundsCompleted = ZERO
    stats.totalPayouts = ZERO
    stats.depositVolume = ZERO
    stats.depositCount = ZERO
    stats.withdrawalVolume = ZERO
    stats.withdrawalCount = ZERO
    stats.stakersRevenue = ZERO
    stats.timestamp = timestamp
  }
  return stats
}

export function trackDailyUniquePlayer(timestamp: BigInt, playerAddress: string): boolean {
  const dayNumber = timestamp.div(SECONDS_PER_DAY)
  const id = dayNumber.toString() + "-" + playerAddress
  let dp = DailyPlayer.load(id)
  if (dp == null) {
    dp = new DailyPlayer(id)
    dp.save()
    return true // new player today
  }
  return false
}

export function getOrCreateHourlySnapshot(timestamp: BigInt): HourlyVolumeSnapshot {
  const hourNumber = timestamp.div(SECONDS_PER_HOUR)
  const id = hourNumber.toString()
  let snapshot = HourlyVolumeSnapshot.load(id)
  if (snapshot == null) {
    snapshot = new HourlyVolumeSnapshot(id)
    snapshot.hour = hourNumber.toI32()
    snapshot.volume = ZERO
    snapshot.betCount = ZERO
    snapshot.uniquePlayers = ZERO
    snapshot.depositVolume = ZERO
    snapshot.withdrawalVolume = ZERO
    snapshot.totalPayouts = ZERO
    snapshot.stakersRevenue = ZERO
    snapshot.timestamp = hourNumber.times(SECONDS_PER_HOUR)
  }
  return snapshot
}

export function trackHourlyUniquePlayer(timestamp: BigInt, playerAddress: string): boolean {
  const hourNumber = timestamp.div(SECONDS_PER_HOUR)
  const id = hourNumber.toString() + "-" + playerAddress
  let hp = HourlyPlayer.load(id)
  if (hp == null) {
    hp = new HourlyPlayer(id)
    hp.save()
    return true // new player this hour
  }
  return false
}
