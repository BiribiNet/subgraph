import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { Market, RouletteMaskLeg, UserSpecialBetStats } from "../../generated/schema"
import { ONE, ZERO } from "./number"

// Statistiques par pari spécial dans le compte : une ligne par (utilisateur, marché, preset
// canonique). Par marché parce que les montants sont en unités de l'actif du marché (comme
// UserMarketStats) : additionner des USDC et des BRB n'aurait pas de sens.

function statsId(user: Bytes, marketId: i32, presetId: i32): Bytes {
  return user.concatI32(marketId).concatI32(presetId)
}

/** Ajoute une jambe qui vient d'être réglée aux stats de son preset. Appelée une fois par jambe. */
export function recordSpecialBetStats(leg: RouletteMaskLeg, timestamp: BigInt): void {
  const market = Market.load(leg.market)
  // Une jambe est toujours rattachée à un marché enregistré ; 0 ne sert qu'en garde-fou.
  const marketId = market != null ? market.marketId : 0
  const id = statsId(leg.user, marketId, leg.canonicalPresetId)
  let stats = UserSpecialBetStats.load(id)
  if (stats == null) {
    stats = new UserSpecialBetStats(id)
    stats.user = leg.user
    stats.market = leg.market
    stats.presetId = leg.canonicalPresetId
    stats.betCount = ZERO
    stats.winCount = ZERO
    stats.totalWagered = ZERO
    stats.totalWon = ZERO
    stats.netResult = ZERO
  }
  const payout = leg.payout
  const won = payout !== null ? payout : ZERO
  stats.betCount = stats.betCount.plus(ONE)
  if (leg.won) stats.winCount = stats.winCount.plus(ONE)
  stats.totalWagered = stats.totalWagered.plus(leg.amount)
  stats.totalWon = stats.totalWon.plus(won)
  stats.netResult = stats.totalWon.minus(stats.totalWagered)
  stats.updatedAt = timestamp
  stats.save()
}
