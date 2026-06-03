import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { SideBet, SideBetRoundPending } from "../../generated/schema"
import { globalRoundIdBytes } from "./globalRound"

export function registerSideBetForRoundWatch(
  sideBetId: Bytes,
  startGlobalRound: BigInt,
  windowSpins: i32
): void {
  for (let i = 0; i < windowSpins; i++) {
    const roundNumber = startGlobalRound.plus(BigInt.fromI32(i))
    const pendingId = globalRoundIdBytes(roundNumber)
    let pending = SideBetRoundPending.load(pendingId)
    if (pending == null) {
      pending = new SideBetRoundPending(pendingId)
      pending.sideBetIds = []
    }
    const ids = pending.sideBetIds
    ids.push(sideBetId)
    pending.sideBetIds = ids
    pending.save()
  }
}

export function observeSideBetSpinsForRound(roundId: BigInt, winningNumber: BigInt): void {
  const pending = SideBetRoundPending.load(globalRoundIdBytes(roundId))
  if (pending == null) {
    return
  }
  for (let i = 0; i < pending.sideBetIds.length; i++) {
    const bet = SideBet.load(pending.sideBetIds[i])
    if (bet == null || bet.status != "ACTIVE") {
      continue
    }
    const spins = bet.spinsObserved
    spins.push(winningNumber)
    bet.spinsObserved = spins
    bet.spinsResolved = spins.length
    bet.save()
  }
}
