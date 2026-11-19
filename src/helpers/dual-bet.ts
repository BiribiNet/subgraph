import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { RouletteBet, RouletteDualLeg, RouletteRound } from "../../generated/schema"
import { DecodedBetData } from "./bet-data"
import { BET_DUAL } from "./constant"
import { isRed, wheelIndexOf } from "./special-bet-presets"

const VARIANTS = [
  "OPPOSITE_COLORS", "SAME_ENDING", "WHEEL_NEIGHBORS", "SUM_37",
  "DOUBLE_MASK", "REFUND_MASK", "EXACT_PAIR", "DOUBLE_ZERO",
]
const WINS = [648, 96, 74, 36, 0, 0, 2, 1]
const ZERO = BigInt.zero()

export class DualSelection {
  variant: i32
  roulette: i32[] = []
  jackpot: i32[] = []

  constructor(variant: i32) {
    this.variant = variant
  }
}

function unpackPockets(packed: u32): i32[] {
  const pockets: i32[] = []
  let previous = 0
  while (packed != 0) {
    const field = i32(packed & 63)
    if (field <= previous || field > 37) return []
    pockets.push(field - 1)
    previous = field
    packed >>= 6
  }
  return pockets
}

export function decodeDualSelection(raw: BigInt): DualSelection | null {
  if (raw.lt(ZERO) || !raw.rightShift(51).isZero()) return null
  const selection = new DualSelection(raw.bitAnd(BigInt.fromI32(7)).toI32())
  const low = raw.rightShift(3)
  if (selection.variant == 4 || selection.variant == 5) {
    selection.roulette = unpackPockets(low.bitAnd(BigInt.fromI32(0xffffff)).toU32())
    selection.jackpot = unpackPockets(raw.rightShift(27).toU32())
    if (selection.roulette.length < 2 || selection.jackpot.length < 2) return null
  } else if (selection.variant == 6) {
    if (!raw.rightShift(15).isZero()) return null
    selection.roulette = unpackPockets(low.toU32())
    if (selection.roulette.length != 2) return null
  } else if (!low.isZero()) {
    return null
  }
  return selection
}

export function maximumDualReturn(selection: DualSelection, amount: BigInt): BigInt {
  let wins = WINS[selection.variant]
  let refunds = 0
  if (selection.variant == 4 || selection.variant == 5) {
    wins = selection.roulette.length * selection.jackpot.length
    if (selection.variant == 5) refunds = (selection.roulette.length + selection.jackpot.length) * 37 - 2 * wins
  }
  return amount.times(BigInt.fromI32(1332 - refunds)).div(BigInt.fromI32(wins))
}

export function dualDrawOutcome(selection: DualSelection, r: i32, j: i32): string {
  if (r < 0 || r > 36 || j < 0 || j > 36) return "LOST"
  let won = false
  switch (selection.variant) {
    case 0: won = r != 0 && j != 0 && isRed(r) != isRed(j); break
    case 1: won = r != 0 && j != 0 && r != j && r % 10 == j % 10; break
    case 2: {
      const distance = abs(wheelIndexOf(r) - wheelIndexOf(j))
      won = distance == 1 || distance == 36
      break
    }
    case 3: won = r + j == 37; break
    case 6: won = r != j && selection.roulette.includes(r) && selection.roulette.includes(j); break
    case 7: won = r == 0 && j == 0; break
    default: {
      const hitRoulette = selection.roulette.includes(r)
      const hitJackpot = selection.jackpot.includes(j)
      if (selection.variant == 5 && hitRoulette != hitJackpot) return "REFUNDED"
      won = hitRoulette && hitJackpot
    }
  }
  return won ? "WON" : "LOST"
}

export function recordDualLegs(
  payload: DecodedBetData, bet: RouletteBet, round: RouletteRound, tx: Bytes, logIndex: BigInt
): void {
  const type = BigInt.fromI32(BET_DUAL)
  for (let index = 0; index < payload.types.length; index++) {
    if (!payload.types[index].equals(type)) continue
    const selection = decodeDualSelection(payload.numbers[index])
    const amount = payload.amounts[index]
    if (selection == null || amount.le(ZERO)) continue
    const id = tx.concatI32(logIndex.toI32()).concatI32(index)
    if (RouletteDualLeg.load(id) != null) continue
    const leg = new RouletteDualLeg(id)
    leg.bet = bet.id
    leg.round = round.id
    leg.market = round.market
    leg.transactionHash = tx
    leg.legIndex = index
    leg.rawNumber = payload.numbers[index]
    leg.amount = amount
    leg.variant = VARIANTS[selection.variant]
    leg.roulettePockets = selection.roulette
    leg.jackpotPockets = selection.jackpot
    leg.maximumReturn = maximumDualReturn(selection, amount)
    leg.save()
    round.dualBetsPayout = round.dualBetsPayout.plus(leg.maximumReturn)
  }
}

export function settleDualLegsOfRound(round: RouletteRound, roulette: i32, jackpot: i32): void {
  if (round.dualBetsPayout.isZero()) return
  const legs = round.dualLegs.load()
  let total = ZERO
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const selection = decodeDualSelection(leg.rawNumber)
    if (selection == null) continue
    const result = dualDrawOutcome(selection, roulette, jackpot)
    const payout = result == "WON" ? leg.maximumReturn : result == "REFUNDED" ? leg.amount : ZERO
    leg.outcome = result
    leg.drawReturn = payout
    leg.save()
    total = total.plus(payout)
  }
  round.dualDrawPayout = total
  round.save()
}
