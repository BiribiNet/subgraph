import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
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
  BatchProcessed,
  ComputedPayouts,
  JackpotResultEvent,
  MinJackpotConditionUpdated,
} from '../generated/RouletteClean/Game';
import {
  handleVrfRequested,
  handleVRFResult,
  handleRoundResolved,
  handleBatchProcessed,
  handleComputedPayouts,
  handleJackpotResultEvent,
  handleMinJackpotConditionUpdated,
} from '../src/mappings/roulette';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_VRF,
  ROUND_STATUS_PAYOUT,
  ROUND_STATUS_COMPUTING_PAYOUT,
  ROUND_STATUS_CLEAN,
} from '../src/helpers/constant';

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
    new ethereum.EventParam(
      'newRoundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(newRoundId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'requestId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(requestId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'timestamp',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(timestamp))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createVRFResultEvent(
  roundId: i32,
  jackpotNumber: i32,
  winningNumber: i32,
  timestamp: i32 = 1000100
): VRFResult {
  const ev = changetype<VRFResult>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'jackpotNumber',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(jackpotNumber))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'winningNumber',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createRoundResolvedEvent(
  roundId: i32,
  timestamp: i32 = 1000200
): RoundResolved {
  const ev = changetype<RoundResolved>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createBatchProcessedEvent(
  roundId: i32,
  batchIndex: i32,
  payoutsCount: i32,
  timestamp: i32 = 1000150
): BatchProcessed {
  const ev = changetype<BatchProcessed>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'batchIndex',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(batchIndex))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'payoutsCount',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(payoutsCount))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createComputedPayoutsEvent(
  roundId: i32,
  totalWinningBets: i32,
  timestamp: i32 = 1000120
): ComputedPayouts {
  const ev = changetype<ComputedPayouts>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'totalWinningBets',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(totalWinningBets))
    )
  );
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

function createJackpotResultEvent(
  roundId: i32,
  jackpotWinnerCount: i32,
  timestamp: i32 = 1000110
): JackpotResultEvent {
  const ev = changetype<JackpotResultEvent>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))
    )
  );
  ev.parameters.push(
    new ethereum.EventParam(
      'jackpotWinnerCount',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(jackpotWinnerCount))
    )
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

describe('handleVrfRequested', () => {
  beforeEach(() => {
    clearStore();
  });

  test('creates new round with correct initial state', () => {
    const ev = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(ev);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.entityCount('RouletteRound', 1);
    assert.fieldEquals('RouletteRound', roundId, 'roundNumber', '1');
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('RouletteRound', roundId, 'totalBets', '0');
    assert.fieldEquals('RouletteRound', roundId, 'maxBetAmount', '0');
    assert.fieldEquals('RouletteRound', roundId, 'maxStraightBet', '0');
    assert.fieldEquals('RouletteRound', roundId, 'maxStreetBet', '0');
    assert.fieldEquals('RouletteRound', roundId, 'redBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'blackBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'oddBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'evenBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'lowBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'highBetsSum', '0');
    assert.fieldEquals('RouletteRound', roundId, 'otherBetsPayout', '0');
    assert.fieldEquals('RouletteRound', roundId, 'currentPayoutsCount', '0');
    assert.fieldEquals('RouletteRound', roundId, 'totalPayouts', '0');
    assert.fieldEquals('RouletteRound', roundId, 'uniqueBettors', '0');
    assert.fieldEquals('RouletteRound', roundId, 'betCount', '0');
    assert.fieldEquals('RouletteRound', roundId, 'startedAt', '1000000');

    // GlobalState should be updated
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '1');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalRounds', '1');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'lastRoundStartTime', '1000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundTransitionInProgress', 'true');
  });

  test('updates previous round to VRF status', () => {
    // Create round 1
    const ev1 = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(ev1);

    const round1Id = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', round1Id, 'status', ROUND_STATUS_BETTING);

    // Create round 2, which should set round 1 to VRF status
    const ev2 = createVrfRequestedEvent(2, 200, 1000100);
    handleVrfRequested(ev2);

    assert.fieldEquals('RouletteRound', round1Id, 'status', ROUND_STATUS_VRF);
    assert.fieldEquals('RouletteRound', round1Id, 'requestId', '200');

    const round2Id = bigintToBytes(BigInt.fromI32(2)).toHexString();
    assert.fieldEquals('RouletteRound', round2Id, 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '2');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalRounds', '2');
  });
});

describe('handleVRFResult', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets winning number, jackpot number, and status to PAYOUT', () => {
    // Create round 1 first
    const vrfEv = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(vrfEv);

    // Emit VRFResult for round 1
    const resultEv = createVRFResultEvent(1, 5, 17, 1000100);
    handleVRFResult(resultEv);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'winningNumber', '17');
    assert.fieldEquals('RouletteRound', roundId, 'jackpotNumber', '5');
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_PAYOUT);
    assert.fieldEquals('RouletteRound', roundId, 'vrfResultAt', '1000100');
  });
});

describe('handleComputedPayouts', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets computed count and updates status to COMPUTING_PAYOUT', () => {
    // Create round 1
    const vrfEv = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(vrfEv);

    // Emit ComputedPayouts for round 1
    const computedEv = createComputedPayoutsEvent(1, 3, 1000120);
    handleComputedPayouts(computedEv);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'computedPayoutsCount', '3');
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_COMPUTING_PAYOUT);
  });
});

describe('handleBatchProcessed', () => {
  beforeEach(() => {
    clearStore();
  });

  test('increments currentPayoutsCount', () => {
    // Create round 1
    const vrfEv = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(vrfEv);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'currentPayoutsCount', '0');

    // Process first batch with 5 payouts
    const batch1 = createBatchProcessedEvent(1, 0, 5, 1000150);
    handleBatchProcessed(batch1);

    assert.fieldEquals('RouletteRound', roundId, 'currentPayoutsCount', '5');

    // Process second batch with 3 payouts
    const batch2 = createBatchProcessedEvent(1, 1, 3, 1000160);
    handleBatchProcessed(batch2);

    assert.fieldEquals('RouletteRound', roundId, 'currentPayoutsCount', '8');
  });
});

describe('handleRoundResolved', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets status to CLEAN and updates globalState', () => {
    // Create round 1
    const vrfEv = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(vrfEv);

    // Resolve round 1
    const resolvedEv = createRoundResolvedEvent(1, 1000200);
    handleRoundResolved(resolvedEv);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_CLEAN);
    assert.fieldEquals('RouletteRound', roundId, 'resolvedAt', '1000200');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'pendingBets', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'lastRoundPaid', '1');
  });
});

describe('handleJackpotResultEvent', () => {
  beforeEach(() => {
    clearStore();
  });

  test('sets jackpot winner count on round', () => {
    // Create round 1
    const vrfEv = createVrfRequestedEvent(1, 100, 1000000);
    handleVrfRequested(vrfEv);

    // Emit JackpotResultEvent for round 1
    const jackpotEv = createJackpotResultEvent(1, 2, 1000110);
    handleJackpotResultEvent(jackpotEv);

    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'jackpotWinnerCount', '2');
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
