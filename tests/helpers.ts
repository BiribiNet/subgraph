import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as";

import { RouletteRound } from "../generated/schema";
import { createNewRouletteRound } from "../src/helpers/rouletteRound";

/**
 * Bootstrap a RouletteRound entity directly, without emitting an event.
 * Replaces the legacy `emitRoundCleaningCompleted()` helper — that event was
 * removed from the engine ABI in Phase 1C. Manual creation is acceptable for
 * tests because we only need the entity to exist with sane defaults; production
 * indexing creates the round via `handleBetRecorded()` (provisional) or
 * `handleRoundLocked()`.
 */
export function createRoundForTests(roundNumber: i32, timestamp: i32): RouletteRound {
  const round = createNewRouletteRound(BigInt.fromI32(roundNumber), BigInt.fromI32(timestamp));
  round.save();
  return round;
}

/**
 * Mock a block timestamp + number on an event. Convenience wrapper around the
 * common pattern used in the test files prior to Phase 1C.
 */
export function withBlock<T extends ethereum.Event>(event: T, timestamp: i32, blockNumber: i32): T {
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(blockNumber);
  return event;
}

/**
 * Return a fresh mock event scaffolded with empty parameters. Use this when
 * you need a base event for building a typed event mock.
 */
export function emptyMockEvent(): ethereum.Event {
  const ev = newMockEvent();
  ev.parameters = new Array<ethereum.EventParam>();
  return ev;
}
