import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as"
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import { TipSent } from "../generated/templates/TipJar/TipJar"
import { handleTipSent } from "../src/mappings/tips"
import { bigintToBytes } from "../src/helpers/bigintToBytes"

function tip(index: i32, amount: i32 = 100): TipSent {
  const event = changetype<TipSent>(newMockEvent())
  event.address = Address.fromString("0x1111111111111111111111111111111111111111")
  event.logIndex = BigInt.fromI32(index)
  event.parameters = [
    new ethereum.EventParam("sender", ethereum.Value.fromAddress(Address.fromString("0x2222222222222222222222222222222222222222"))),
    new ethereum.EventParam("token", ethereum.Value.fromAddress(Address.fromString("0x3333333333333333333333333333333333333333"))),
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
    assert.entityCount("User", 0)
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
})
