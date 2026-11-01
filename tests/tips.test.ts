import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as"
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import { TipSent } from "../generated/templates/TipJar/TipJar"
import { handleTipSent } from "../src/mappings/tips"
import { bigintToBytes } from "../src/helpers/bigintToBytes"
import { BRB_TOKEN_ADDRESS } from "../src/helpers/constant"
import { recomputeAndSaveUserPoints } from "../src/helpers/brb-points"
import { getOrCreateUser } from "../src/helpers/user"

function tip(index: i32, amount: i32 = 100): TipSent {
  const event = changetype<TipSent>(newMockEvent())
  event.address = Address.fromString("0x1111111111111111111111111111111111111111")
  event.logIndex = BigInt.fromI32(index)
  event.parameters = [
    new ethereum.EventParam("sender", ethereum.Value.fromAddress(Address.fromString("0x2222222222222222222222222222222222222222"))),
    new ethereum.EventParam("token", ethereum.Value.fromAddress(BRB_TOKEN_ADDRESS)),
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(Address.fromString("0x4444444444444444444444444444444444444444"))),
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(amount))),
  ]
  return event
}

describe("Voluntary TipSent indexing", () => {
  beforeEach(() => clearStore())
  test("records exact evidence and separates tips from gameplay", () => {
    const event = tip(0)
    handleTipSent(event)
    const id = event.transaction.hash.concat(bigintToBytes(event.logIndex)).toHexString()
    assert.fieldEquals("Tip", id, "amount", "100")
    assert.fieldEquals("Tip", id, "sender", event.params.sender.toHexString())
    assert.fieldEquals("Tip", id, "transactionHash", event.transaction.hash.toHexString())
    assert.entityCount("RouletteBet", 0)
    assert.entityCount("User", 1)
    assert.fieldEquals("User", event.params.sender.toHexString(), "totalTipsSent", "100")
    assert.fieldEquals("User", event.params.sender.toHexString(), "tipPoints", "0")
    assert.entityCount("TipTotal", 1)
  })
  test("deduplicates the same log but retains separate logs in one transaction", () => {
    const event = tip(0)
    handleTipSent(event)
    handleTipSent(event)
    handleTipSent(tip(1, 25))
    assert.entityCount("Tip", 2)
    const id = event.address.concat(event.params.token).concat(event.params.recipient).toHexString()
    assert.fieldEquals("TipTotal", id, "amount", "125")
    assert.fieldEquals("TipTotal", id, "count", "2")
    assert.fieldEquals("User", event.params.sender.toHexString(), "totalTipsSent", "125")
    assert.fieldEquals("User", event.params.sender.toHexString(), "tipCount", "2")
  })
  test("keeps router deployments separate and ignores zero amounts", () => {
    handleTipSent(tip(0, 0))
    assert.entityCount("Tip", 0)
    handleTipSent(tip(1))
    const other = tip(2)
    other.address = Address.fromString("0x5555555555555555555555555555555555555555")
    handleTipSent(other)
    assert.entityCount("TipTotal", 2)
  })
  test("awards exactly three points per BRB and snapshots tier without changing game stats", () => {
    const event = tip(0)
    event.parameters[3] = new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("200000000000000000000")))
    handleTipSent(event)
    handleTipSent(event)
    const account = event.params.sender.toHexString()
    assert.fieldEquals("User", account, "totalTipsSent", "200000000000000000000")
    assert.fieldEquals("User", account, "tipCount", "1")
    assert.fieldEquals("User", account, "tipPoints", "600")
    assert.fieldEquals("User", account, "brbpPoints", "600")
    assert.fieldEquals("User", account, "tier", "SILVER")
    assert.fieldEquals("User", account, "totalRouletteBets", "0")
    assert.fieldEquals("User", account, "totalStaked", "0")
    assert.entityCount("UserDailyPoints", 1)
    const user = getOrCreateUser(event.params.sender)
    user.totalBrbrEarned = BigInt.fromString("1000000000000000000")
    recomputeAndSaveUserPoints(user, event.block.timestamp)
    assert.fieldEquals("User", account, "brbpPoints", "602")
  })
  test("accumulates fractions before rounding and separates senders", () => {
    const first = tip(0)
    first.parameters[3] = new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("200000000000000000")))
    handleTipSent(first)
    assert.fieldEquals("User", first.params.sender.toHexString(), "tipPoints", "0")
    const next = tip(1)
    next.parameters[3] = first.parameters[3]
    handleTipSent(next)
    assert.fieldEquals("User", first.params.sender.toHexString(), "tipPoints", "1")
    const other = tip(2)
    other.parameters[0] = new ethereum.EventParam("sender", ethereum.Value.fromAddress(Address.fromString("0x5555555555555555555555555555555555555555")))
    handleTipSent(other)
    assert.fieldEquals("User", other.params.sender.toHexString(), "tipCount", "1")
    assert.fieldEquals("User", first.params.sender.toHexString(), "tipCount", "2")
  })
  test("does not award points for another asset or a self payment", () => {
    const foreign = tip(0)
    foreign.parameters[1] = new ethereum.EventParam("token", ethereum.Value.fromAddress(Address.fromString("0x6666666666666666666666666666666666666666")))
    handleTipSent(foreign)
    assert.entityCount("User", 0)
    const self = tip(1)
    self.parameters[2] = self.parameters[0]
    handleTipSent(self)
    assert.entityCount("User", 0)
  })
})
