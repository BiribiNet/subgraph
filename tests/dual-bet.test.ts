import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as"
import { VRFResult } from "../generated/RouletteEngine/Game"
import { RouletteRound } from "../generated/schema"
import { handleVRFResult } from "../src/mappings/roulette"
import { decodeDualSelection, dualDrawOutcome, maximumDualReturn } from "../src/helpers/dual-bet"
import { DEFAULT_USER, emitBetRecorded, encodeBetLegs, setupTestMarket, testRoundId } from "./helpers"

// Same canonical numbers and odds used by the contract and UI fixtures.
const NUMBERS = ["0", "1", "2", "3", "16665816212548", "16664607920141", "9286", "7"]
const WINS = [648, 96, 74, 36, 9, 9, 2, 1]
const REFUNDS = [0, 0, 0, 0, 0, 204, 0, 0]
const ROULETTE = [1, 7, 0, 5, 7, 0, 17, 0]
const JACKPOT = [2, 27, 26, 32, 29, 0, 7, 0]

function vrf(r: i32, j: i32): void {
  const event = changetype<VRFResult>(newMockEvent())
  event.parameters = [
    new ethereum.EventParam("roundId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
    new ethereum.EventParam("winningNumber", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(r))),
    new ethereum.EventParam("jackpotNumber", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(j))),
  ]
  handleVRFResult(event)
}

describe("Two balls", () => {
  beforeEach(() => {
    clearStore()
    setupTestMarket()
  })

  test("matches contract counts and winning examples across all ordered draws", () => {
    const amount = BigInt.fromI32(1000001)
    for (let variant = 0; variant < NUMBERS.length; variant++) {
      const selection = decodeDualSelection(BigInt.fromString(NUMBERS[variant]))!
      assert.i32Equals(selection.variant, variant)
      assert.stringEquals(dualDrawOutcome(selection, ROULETTE[variant], JACKPOT[variant]), "WON")
      let wins = 0
      let refunds = 0
      for (let r = 0; r < 37; r++) {
        for (let j = 0; j < 37; j++) {
          const outcome = dualDrawOutcome(selection, r, j)
          if (outcome == "WON") wins++
          if (outcome == "REFUNDED") refunds++
        }
      }
      assert.i32Equals(wins, WINS[variant])
      assert.i32Equals(refunds, REFUNDS[variant])
      assert.bigIntEquals(maximumDualReturn(selection, amount),
        amount.times(BigInt.fromI32(1332 - refunds)).div(BigInt.fromI32(wins)))
    }
    assert.assertNull(decodeDualSelection(BigInt.fromI32(1).leftShift(51)))
    assert.assertNull(decodeDualSelection(BigInt.fromI32(8)))
  })

  test("records DUAL and distinguishes a win, refund and loss from transfer progress", () => {
    const legType = BigInt.fromI32(17)
    const amount = BigInt.fromI32(1_000_000)
    const ticket = encodeBetLegs(
      [legType, legType, legType],
      [BigInt.fromI32(2), BigInt.fromString(NUMBERS[5]), BigInt.fromI32(7)],
      [amount, amount, amount]
    )
    emitBetRecorded(DEFAULT_USER, "3000000", ticket, 1)
    const roundId = Bytes.fromHexString(testRoundId(1))
    let round = RouletteRound.load(roundId)!
    let legs = round.dualLegs.load()
    assert.i32Equals(legs.length, 3)
    assert.bigIntEquals(round.dualBetsPayout, BigInt.fromString("1475333333"))
    for (let i = 0; i < legs.length; i++) assert.assertTrue(legs[i].get("drawReturn") === null)

    vrf(0, 26)
    vrf(0, 26)
    round = RouletteRound.load(roundId)!
    legs = round.dualLegs.load()
    assert.bigIntEquals(round.dualDrawPayout, BigInt.fromI32(19_000_000))
    assert.entityCount("RouletteDualVariantStat", 3)
    assert.fieldEquals("RouletteDualVariantStat", "1-WHEEL_NEIGHBORS", "won", "1")
    assert.fieldEquals("RouletteDualVariantStat", "1-WHEEL_NEIGHBORS", "netResult", "17000000")
    assert.fieldEquals("RouletteDualVariantStat", "1-REFUND_MASK", "refunded", "1")
    assert.fieldEquals("RouletteDualVariantStat", "1-REFUND_MASK", "grossReturn", "1000000")
    assert.fieldEquals("RouletteDualVariantStat", "1-REFUND_MASK", "netResult", "0")
    assert.fieldEquals("RouletteDualVariantStat", "1-DOUBLE_ZERO", "lost", "1")
    assert.fieldEquals("RouletteDualVariantStat", "1-DOUBLE_ZERO", "netResult", "-1000000")
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]
      const outcome = leg.legIndex == 0 ? "WON" : leg.legIndex == 1 ? "REFUNDED" : "LOST"
      assert.stringEquals(leg.outcome!, outcome)
      assert.fieldEquals("RouletteBet", leg.bet.toHexString(), "actualPayout", "0")
      assert.fieldEquals("RouletteBet", leg.bet.toHexString(), "betTypes", "[DUAL, DUAL, DUAL]")
    }
  })
})
