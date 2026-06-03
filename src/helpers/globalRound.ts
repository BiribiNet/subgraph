import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { GlobalRound } from "../../generated/schema"
import { ROUND_STATUS_BETTING } from "./constant"
import { bigintToBytes } from "./bigintToBytes"
import { ZERO } from "./number"

export function getOrCreateGlobalRound(roundNumber: BigInt, startedAt: BigInt): GlobalRound {
  const id = bigintToBytes(roundNumber)
  let gr = GlobalRound.load(id)
  if (gr == null) {
    gr = new GlobalRound(id)
    gr.roundNumber = roundNumber
    gr.status = ROUND_STATUS_BETTING
    gr.startedAt = startedAt
    gr.forceResolved = false
    gr.participantMarketCount = BigInt.fromI32(0)
    gr.firstBetAt = ZERO
    gr.lockAt = ZERO
  }
  return gr
}

export function globalRoundIdBytes(roundNumber: BigInt): Bytes {
  return bigintToBytes(roundNumber)
}
