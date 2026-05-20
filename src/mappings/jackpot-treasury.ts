import { log } from "@graphprotocol/graph-ts"

import { EngineSet } from "../../generated/JackpotTreasury/JackpotTreasury"

/**
 * `JackpotTreasury.EngineSet` is admin-only and fires once per engine address
 * rotation. We log it for traceability but don't materialize an entity — there
 * is no consumer query for this in Phase 1C bis. Add a `JackpotTreasuryConfig`
 * singleton in a follow-up if the analytics team needs to track rotations.
 */
export function handleEngineSet(event: EngineSet): void {
  log.info("JackpotTreasury EngineSet: {}", [event.params.engine.toHexString()])
}
