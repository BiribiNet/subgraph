import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  CallAllowedSet,
  CallExecuted,
  CallFailed,
} from "../../generated/AutomationReceiver/AutomationReceiver"
import {
  AutomationCall,
  AutomationCallAllowance,
  GlobalRound,
} from "../../generated/schema"
import { getOrCreateGlobalState } from "../helpers/globalState"

const ONE = BigInt.fromI32(1)

function automationCallId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

function createAutomationCall(
  event: ethereum.Event,
  target: Bytes,
  selector: Bytes,
  success: boolean,
  reason: Bytes | null
): void {
  const call = new AutomationCall(automationCallId(event))
  call.target = target
  call.selector = selector
  call.success = success
  call.reason = reason
  call.blockNumber = event.block.number
  call.timestamp = event.block.timestamp
  call.transactionHash = event.transaction.hash
  call.save()
}

export function handleCallExecuted(event: CallExecuted): void {
  createAutomationCall(
    event,
    changetype<Bytes>(event.params.target),
    changetype<Bytes>(event.params.selector),
    true,
    null
  )
}

export function handleCallFailed(event: CallFailed): void {
  createAutomationCall(
    event,
    changetype<Bytes>(event.params.target),
    changetype<Bytes>(event.params.selector),
    false,
    event.params.reason
  )

  // A failed relayed call does not revert the CRE report — count it on the
  // lifetime health metric and attribute it to the round that was current.
  // (The event carries no round/market info, so per-market attribution is
  // impossible; RouletteRound.failedPayoutBatches stays reserved.)
  const globalState = getOrCreateGlobalState()
  globalState.failedAutomationCalls = globalState.failedAutomationCalls.plus(ONE)
  globalState.save()

  const currentRound = GlobalRound.load(globalState.currentGlobalRound)
  if (currentRound != null) {
    currentRound.failedAutomationCalls = currentRound.failedAutomationCalls.plus(ONE)
    currentRound.save()
  }
}

export function handleCallAllowedSet(event: CallAllowedSet): void {
  const target = changetype<Bytes>(event.params.target)
  const selector = changetype<Bytes>(event.params.selector)
  const id = target.concat(selector)
  let allowance = AutomationCallAllowance.load(id)
  if (allowance == null) {
    allowance = new AutomationCallAllowance(id)
    allowance.target = target
    allowance.selector = selector
  }
  allowance.allowed = event.params.allowed
  allowance.updatedAt = event.block.timestamp
  allowance.save()
}
