import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { DailyStat, DailyPlayer, HourlyVolumeSnapshot, HourlyPlayer, RouletteRound } from "../../generated/schema"
import { ZERO } from "./number"
import { getOrCreateGlobalState } from "./globalState"

const SECONDS_PER_DAY = BigInt.fromI32(86400)
const SECONDS_PER_HOUR = BigInt.fromI32(3600)

export function getOrCreateDailyStats(timestamp: BigInt): DailyStat {
  const dayNumber = timestamp.div(SECONDS_PER_DAY)
  const id = dayNumber.toString()
  let stats = DailyStat.load(id)
  if (stats == null) {
    stats = new DailyStat(id)
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

export function updateRoundRevenueAggregates(round: RouletteRound, timestamp: BigInt): void {
  if (round.totalBets.le(round.totalPayouts)) {
    return
  }
  const grossRevenue = round.totalBets.minus(round.totalPayouts)
  const stakersShare = grossRevenue.minus(round.jackpotRevenue).minus(round.infraRevenue)
  const daily = getOrCreateDailyStats(timestamp)
  daily.revenue = daily.revenue.plus(grossRevenue)
  if (stakersShare.gt(ZERO)) {
    daily.stakersRevenue = daily.stakersRevenue.plus(stakersShare)
    const globalState = getOrCreateGlobalState()
    globalState.totalStakerRevenue = globalState.totalStakerRevenue.plus(stakersShare)
    globalState.save()
  }
  daily.save()
}
