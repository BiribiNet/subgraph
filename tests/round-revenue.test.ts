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
  InfrastructureFeePaid,
  JackpotFunded,
} from '../generated/RouletteEngine/Game';
import {
  handleInfrastructureFeePaid,
  handleJackpotFunded,
} from '../src/mappings/roulette';
import { createRoundForTests, testRoundId } from './helpers';

const ENGINE = Address.fromString('0x7eb8110d9e84d3c32fa6468d13ea2bc81544acf1');

function revenueEvent<T extends ethereum.Event>(
  event: T,
  globalRoundId: i32,
  marketId: i32,
  amount: string
): T {
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'globalRoundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(globalRoundId))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(marketId)))
  );
  event.parameters.push(
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount)))
  );
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

describe('Round revenue splits', () => {
  beforeEach(() => {
    clearStore();
  });

  test('JackpotFunded accumulates jackpotRevenue on the market round', () => {
    createRoundForTests(7, 1_000_000);

    handleJackpotFunded(revenueEvent(changetype<JackpotFunded>(newMockEvent()), 7, 1, '2500000'));
    handleJackpotFunded(revenueEvent(changetype<JackpotFunded>(newMockEvent()), 7, 1, '1500000'));

    assert.fieldEquals('RouletteRound', testRoundId(7), 'jackpotRevenue', '4000000');
  });

  test('JackpotFunded for an unknown round is a no-op', () => {
    handleJackpotFunded(revenueEvent(changetype<JackpotFunded>(newMockEvent()), 42, 1, '1000'));
    assert.entityCount('RouletteRound', 0);
  });

  test('InfrastructureFeePaid accumulates infraRevenue on the market round', () => {
    createRoundForTests(7, 1_000_000);

    handleInfrastructureFeePaid(
      revenueEvent(changetype<InfrastructureFeePaid>(newMockEvent()), 7, 1, '2000000')
    );

    assert.fieldEquals('RouletteRound', testRoundId(7), 'infraRevenue', '2000000');
  });
});
