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
  MinBetUpdated,
  SideBetControllerUpdated,
} from '../generated/templates/BankVault/BankVault4626';
import {
  handleMinBetUpdated,
  handleSideBetControllerUpdated,
} from '../src/mappings/bank-vault';
import { setupTestMarket, TEST_BANK } from './helpers';

const CONTROLLER = Address.fromString('0xdddd000000000000000000000000000000000001');

function emitMinBetUpdated(previousMinBet: string, newMinBet: string): void {
  const event = changetype<MinBetUpdated>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('previousMinBet', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(previousMinBet)))
  );
  event.parameters.push(
    new ethereum.EventParam('newMinBet', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(newMinBet)))
  );
  handleMinBetUpdated(event);
}

function emitSideBetControllerUpdated(previousController: Address, newController: Address): void {
  const event = changetype<SideBetControllerUpdated>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('previousController', ethereum.Value.fromAddress(previousController))
  );
  event.parameters.push(
    new ethereum.EventParam('newController', ethereum.Value.fromAddress(newController))
  );
  handleSideBetControllerUpdated(event);
}

describe('BankVault config events', () => {
  beforeEach(() => {
    clearStore();
  });

  test('MinBetUpdated updates Market.minBet when the bank is known', () => {
    setupTestMarket();
    emitMinBetUpdated('5000000000000000000', '10000000000000000000');
    assert.fieldEquals('Market', '1', 'minBet', '10000000000000000000');
  });

  test('SideBetControllerUpdated records the new controller on the market', () => {
    setupTestMarket();
    emitSideBetControllerUpdated(Address.zero(), CONTROLLER);
    assert.fieldEquals('Market', '1', 'sideBetController', CONTROLLER.toHexString());
  });

  test('MinBetUpdated for an unknown bank is a no-op', () => {
    // No setupTestMarket → bank reverse lookup misses, handler returns early.
    emitMinBetUpdated('0', '7');
    assert.entityCount('Market', 0);
  });
});
