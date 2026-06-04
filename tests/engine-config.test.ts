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
  WithdrawalQueueBatchSizeUpdated,
  MaxWithdrawalQueueLengthUpdated,
  RoundDurationUpdated,
  JackpotFunderUpdated,
  JackpotTreasuryUpdated,
} from '../generated/RouletteEngine/Game';
import {
  handleWithdrawalQueueBatchSizeUpdated,
  handleMaxWithdrawalQueueLengthUpdated,
  handleRoundDurationUpdated,
  handleJackpotFunderUpdated,
  handleJackpotTreasuryUpdated,
} from '../src/mappings/roulette';
import { GLOBAL_STATE_ID } from './helpers';

const ENGINE = Address.fromString('0x68b830aac2cb41811b957c7380560926dd87cdbd');
const FUNDER = Address.fromString('0xc245ad88d401d08d674596d5a2c9f17011ed27c1');
const TREASURY = Address.fromString('0x4416181c11ee20481c466ed95fc8e997adbf5774');

function emit<T extends ethereum.Event>(event: T): T {
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

describe('RouletteEngine config events', () => {
  beforeEach(() => {
    clearStore();
  });

  test('WithdrawalQueueBatchSizeUpdated sets GlobalState.largeWithdrawalBatchSize', () => {
    const event = emit(changetype<WithdrawalQueueBatchSizeUpdated>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('newBatchSize', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(12)))
    );
    handleWithdrawalQueueBatchSizeUpdated(event);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'largeWithdrawalBatchSize', '12');
  });

  test('MaxWithdrawalQueueLengthUpdated sets GlobalState.maxQueueLength', () => {
    const event = emit(changetype<MaxWithdrawalQueueLengthUpdated>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('newMaxLength', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(250)))
    );
    handleMaxWithdrawalQueueLengthUpdated(event);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'maxQueueLength', '250');
  });

  test('RoundDurationUpdated sets GlobalState.roundDuration', () => {
    const event = emit(changetype<RoundDurationUpdated>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('newRoundDuration', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(45)))
    );
    handleRoundDurationUpdated(event);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundDuration', '45');
  });

  test('JackpotFunderUpdated / JackpotTreasuryUpdated record the active addresses', () => {
    const funderEvent = emit(changetype<JackpotFunderUpdated>(newMockEvent()));
    funderEvent.parameters.push(
      new ethereum.EventParam('previousFunder', ethereum.Value.fromAddress(Address.zero()))
    );
    funderEvent.parameters.push(
      new ethereum.EventParam('newFunder', ethereum.Value.fromAddress(FUNDER))
    );
    handleJackpotFunderUpdated(funderEvent);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'jackpotFunder', FUNDER.toHexString());

    const treasuryEvent = emit(changetype<JackpotTreasuryUpdated>(newMockEvent()));
    treasuryEvent.parameters.push(
      new ethereum.EventParam('previousTreasury', ethereum.Value.fromAddress(Address.zero()))
    );
    treasuryEvent.parameters.push(
      new ethereum.EventParam('newTreasury', ethereum.Value.fromAddress(TREASURY))
    );
    handleJackpotTreasuryUpdated(treasuryEvent);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'jackpotTreasury', TREASURY.toHexString());
  });
});
