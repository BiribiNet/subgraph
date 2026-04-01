import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { BetPlaced, RoundCleaningCompleted } from '../generated/StakedBRB/StakedBRB';
import { handleBetPlaced, handleRoundCleaningCompleted } from '../src/mappings/stakedBRB';
import { VRFResult } from '../generated/RouletteClean/Game';
import { handleVRFResult } from '../src/mappings/roulette';
import { ROUND_STATUS_BETTING } from '../src/helpers/constant';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

const emitRoundCleaningCompleted = (cleanedRoundId: i32, newRoundId: i32, boundaryTs: i32): void => {
    const ev = changetype<RoundCleaningCompleted>(newMockEvent());
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(new ethereum.EventParam('cleanedRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(cleanedRoundId))));
    ev.parameters.push(new ethereum.EventParam('newRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(newRoundId))));
    ev.parameters.push(new ethereum.EventParam('boundaryTimestamp', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(boundaryTs))));
    const feesTuple = new ethereum.Tuple();
    feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
    feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
    feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
    ev.parameters.push(new ethereum.EventParam('fees', ethereum.Value.fromTuple(feesTuple)));
    ev.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
    ev.block.timestamp = BigInt.fromI32(boundaryTs);
    ev.block.number = BigInt.fromI32(10000);
    handleRoundCleaningCompleted(ev);
}

const initializeRound = (): void => {
  emitRoundCleaningCompleted(0, 1, 1_000_000);
}
const initializeBet = (): void => {
  const betPlacedEvent = changetype<BetPlaced>(newMockEvent());
  betPlacedEvent.parameters = new Array<ethereum.EventParam>();
  betPlacedEvent.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString('0xbbbbedc42dc53842141be8f70df9efe4d08538a4'))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("10000000000000000000"))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('data', ethereum.Value.fromBytes(Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1"))));
  betPlacedEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  betPlacedEvent.logIndex = BigInt.fromI32(0);
  betPlacedEvent.block.timestamp = BigInt.fromI32(1_000_000);
  betPlacedEvent.block.number = BigInt.fromI32(10000);
  handleBetPlaced(betPlacedEvent);
};

const vrfResult = (): void => {
  const vrfResultEvent = changetype<VRFResult>(newMockEvent());
  vrfResultEvent.parameters = new Array<ethereum.EventParam>();
  vrfResultEvent.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1"))));
  vrfResultEvent.parameters.push(new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("5"))));
  vrfResultEvent.parameters.push(new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("7"))));
  vrfResultEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  vrfResultEvent.logIndex = BigInt.fromI32(0);
  vrfResultEvent.block.timestamp = BigInt.fromI32(1_000_100);
  vrfResultEvent.block.number = BigInt.fromI32(10001);
  handleVRFResult(vrfResultEvent);
};
describe('RouletteBet tests', () => {
  beforeEach(() => {
    clearStore();
  });

  test('RouletteBet initialized', () => {
    initializeRound()
    initializeBet();
    vrfResult()
    assert.entityCount('RouletteBet', 1);
    // Round ID is bytes, not string
    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_BETTING)
    // assert.fieldEquals('RouletteBet', '0xbbbbedc42dc53842141be8f70df9efe4d08538a41', 'user', '0xbbbbedc42dc53842141be8f70df9efe4d08538a4');
  });

  test('BetPlaced before RoundCleaningCompleted lazily creates round (log order)', () => {
    initializeBet();
    const roundId = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.entityCount('RouletteRound', 1);
    assert.fieldEquals('RouletteRound', roundId, 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('RouletteRound', roundId, 'startedAt', '1000000');

    emitRoundCleaningCompleted(0, 1, 950_000);
    assert.fieldEquals('RouletteRound', roundId, 'startedAt', '950000');
  });
});
