import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { VrfRequested, VRFResult, RoundResolved } from '../generated/RouletteEngine/Game';
import {
  handleVrfRequested,
  handleVRFResult,
  handleRoundResolved,
} from '../src/mappings/roulette';
import {
  GLOBAL_STATE_ID,
  TEST_ENGINE,
  createRoundForTests,
  globalRoundIdHex,
  testRoundId,
} from './helpers';
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_VRF,
  ROUND_STATUS_CLEAN,
} from '../src/helpers/constant';

function createVrfRequestedEvent(newRoundId: i32, requestId: i32 = 1, timestamp: i32 = 1_000_100): VrfRequested {
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
  ev.address = TEST_ENGINE;
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createVRFResultEvent(
  roundId: i32,
  winningNumber: i32,
  jackpotNumber: i32 = 5,
  timestamp: i32 = 1_000_200
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
  ev.address = TEST_ENGINE;
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createRoundResolvedEvent(roundId: i32, timestamp: i32 = 1_000_300): RoundResolved {
  const ev = changetype<RoundResolved>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId)))
  );
  ev.address = TEST_ENGINE;
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

describe('handleVrfRequested', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets GlobalRound to VRF while keeping currentRoundNumber on resolving round', () => {
    createRoundForTests(1, 1_000_000);
    const grId = globalRoundIdHex(1);
    assert.fieldEquals('GlobalRound', grId, 'status', ROUND_STATUS_BETTING);

    const ev = createVrfRequestedEvent(1, 200, 1_000_100);
    handleVrfRequested(ev);

    assert.fieldEquals('GlobalRound', grId, 'status', ROUND_STATUS_VRF);
    assert.fieldEquals('GlobalRound', grId, 'requestId', '200');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '1');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundTransitionInProgress', 'true');
  });
});

describe('handleVRFResult', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets winning + jackpot numbers on GlobalRound without changing market round status', () => {
    createRoundForTests(1, 1_000_000);
    handleVRFResult(createVRFResultEvent(1, 17, 5));

    const grId = globalRoundIdHex(1);
    assert.fieldEquals('GlobalRound', grId, 'winningNumber', '17');
    assert.fieldEquals('GlobalRound', grId, 'jackpotNumber', '5');
    assert.fieldEquals('GlobalRound', grId, 'vrfResultAt', '1000200');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_BETTING);
  });
});

describe('handleRoundResolved', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets GlobalRound to CLEAN, clears pending bets, and opens next global round', () => {
    createRoundForTests(1, 1_000_000);

    handleRoundResolved(createRoundResolvedEvent(1));

    const grId = globalRoundIdHex(1);
    assert.fieldEquals('GlobalRound', grId, 'status', ROUND_STATUS_CLEAN);
    assert.fieldEquals('GlobalRound', grId, 'resolvedAt', '1000300');
    assert.fieldEquals('Market', '1', 'pendingBets', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'lastRoundPaid', '1');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '2');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundTransitionInProgress', 'false');
  });
});
