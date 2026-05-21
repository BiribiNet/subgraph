import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import {
  VrfRequested,
  VRFResult,
  RoundResolved,
  MinJackpotConditionUpdated,
} from '../generated/RouletteEngine/Game';
import {
  handleVrfRequested,
  handleVRFResult,
  handleRoundResolved,
  handleMinJackpotConditionUpdated,
} from '../src/mappings/roulette-engine';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_VRF,
  ROUND_STATUS_CLEAN,
} from '../src/helpers/constant';
import { createRoundForTests } from './helpers';

const GLOBAL_STATE_ID = '0x0000000000000000000000000000000000000001';
const CONTRACT_ADDRESS = '0x15dc1be843c63317e87865e1df14afa782fae171';

function createVrfRequestedEvent(
  newRoundId: i32,
  requestId: i32 = 1,
  timestamp: i32 = 1000000
): VrfRequested {
  const ev = changetype<VrfRequested>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('newRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(newRoundId)))
  );
  ev.parameters.push(
    new ethereum.EventParam('requestId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(requestId)))
  );
  ev.parameters.push(
    new ethereum.EventParam('timestamp', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(timestamp)))
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createVRFResultEvent(
  roundId: i32,
  winningNumber: i32,
  jackpotNumber: i32 = 5,
  timestamp: i32 = 1000100
): VRFResult {
  const ev = changetype<VRFResult>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId)))
  );
  ev.parameters.push(
    new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber)))
  );
  ev.parameters.push(
    new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(jackpotNumber)))
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createRoundResolvedEvent(roundId: i32, timestamp: i32 = 1000200): RoundResolved {
  const ev = changetype<RoundResolved>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId)))
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createMinJackpotConditionUpdatedEvent(
  newMinJackpotCondition: string,
  timestamp: i32 = 1000000
): MinJackpotConditionUpdated {
  const ev = changetype<MinJackpotConditionUpdated>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'newMinJackpotCondition',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(newMinJackpotCondition))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

// Removed tests (Phase 1C deleted the underlying events):
// - handleRoundCleaningCompleted creates new round
// - handleBettingWindowClosed sets NO_MORE_BETS
// - handleComputedPayouts sets COMPUTING_PAYOUT
// - handleBatchProcessed increments currentPayoutsCount (replaced by PayoutBatchProcessed)
// - handleJackpotResultEvent sets jackpotWinnerCount
// A replacement suite belongs in a future rouletteEngineMultiMarket.test.ts
// covering BetRecorded -> RoundLocked -> VRFResult -> PayoutProgress ->
// RoundResolved for the multi-market lifecycle.

describe('handleVrfRequested', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets resolving round to VRF and advances currentRoundNumber', () => {
    createRoundForTests(1, 1000000);
    const round1Id = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', round1Id, 'status', ROUND_STATUS_BETTING);

    const ev = createVrfRequestedEvent(1, 200, 1000100);
    handleVrfRequested(ev);

    assert.fieldEquals('RouletteRound', round1Id, 'status', ROUND_STATUS_VRF);
    assert.fieldEquals('RouletteRound', round1Id, 'requestId', '200');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '2');
  });
});

describe('handleVRFResult', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets winning + jackpot numbers and vrfResultAt without changing status', () => {
    createRoundForTests(1, 1000000);

    const ev = createVRFResultEvent(1, 17, 5, 1000100);
    handleVRFResult(ev);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'winningNumber', '17');
    assert.fieldEquals('RouletteRound', roundId, 'jackpotNumber', '5');
    // VRFResult does not change status — that transition belongs to PayoutProgress / RoundResolved.
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('RouletteRound', roundId, 'vrfResultAt', '1000100');
  });
});

describe('handleRoundResolved', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets status to CLEAN and updates globalState', () => {
    createRoundForTests(1, 1000000);

    const ev = createRoundResolvedEvent(1, 1000200);
    handleRoundResolved(ev);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_CLEAN);
    assert.fieldEquals('RouletteRound', roundId, 'resolvedAt', '1000200');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'pendingBets', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'lastRoundPaid', '1');
  });
});

describe('handleMinJackpotConditionUpdated', () => {
  beforeEach(() => {
    clearStore();
  });

  test('updates global state minJackpotCondition', () => {
    const ev = createMinJackpotConditionUpdatedEvent('500000000000000000');
    handleMinJackpotConditionUpdated(ev);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'minJackpotCondition', '500000000000000000');
  });
});
