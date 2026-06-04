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
  JackpotBurnFailed,
  JackpotTreasuryTransferFailed,
  TokenSwept,
} from '../generated/BRBJackpotFunder/BRBJackpotFunder';
import {
  handleJackpotBurnFailed,
  handleJackpotTreasuryTransferFailed,
  handleTokenSwept,
} from '../src/mappings/jackpot-funder';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import { setupTestMarket } from './helpers';

const FUNDER = Address.fromString('0xc245ad88d401d08d674596d5a2c9f17011ed27c1');
const TREASURY = Address.fromString('0xeeee000000000000000000000000000000000001');
const ASSET = Address.fromString('0xaaaa000000000000000000000000000000000099');
const RECIPIENT = Address.fromString('0xffff000000000000000000000000000000000001');

function baseFunderEvent<T extends ethereum.Event>(event: T): T {
  event.address = FUNDER;
  event.parameters = new Array<ethereum.EventParam>();
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

/** Mirrors the handler id: txHash.concat(bigintToBytes(logIndex)). */
function incidentId(event: ethereum.Event): string {
  return event.transaction.hash.concat(bigintToBytes(event.logIndex)).toHexString();
}

describe('BRBJackpotFunder incident events', () => {
  beforeEach(() => {
    clearStore();
  });

  test('JackpotBurnFailed records a BURN_FAILED incident linked to the market', () => {
    setupTestMarket();
    const event = baseFunderEvent(changetype<JackpotBurnFailed>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('123')))
    );
    handleJackpotBurnFailed(event);

    assert.entityCount('JackpotFunderIncident', 1);
    const id = incidentId(event);
    assert.fieldEquals('JackpotFunderIncident', id, 'kind', 'BURN_FAILED');
    assert.fieldEquals('JackpotFunderIncident', id, 'amount', '123');
    assert.fieldEquals('JackpotFunderIncident', id, 'market', '1');
  });

  test('JackpotTreasuryTransferFailed records the treasury and amount', () => {
    setupTestMarket();
    const event = baseFunderEvent(changetype<JackpotTreasuryTransferFailed>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(
      new ethereum.EventParam('treasury', ethereum.Value.fromAddress(TREASURY))
    );
    event.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('456')))
    );
    handleJackpotTreasuryTransferFailed(event);

    assert.entityCount('JackpotFunderIncident', 1);
    const id = incidentId(event);
    assert.fieldEquals('JackpotFunderIncident', id, 'kind', 'TREASURY_TRANSFER_FAILED');
    assert.fieldEquals('JackpotFunderIncident', id, 'asset', TREASURY.toHexString());
    assert.fieldEquals('JackpotFunderIncident', id, 'amount', '456');
  });

  test('TokenSwept records the swept asset and recipient with no market', () => {
    const event = baseFunderEvent(changetype<TokenSwept>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET))
    );
    event.parameters.push(
      new ethereum.EventParam('to', ethereum.Value.fromAddress(RECIPIENT))
    );
    event.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('789')))
    );
    handleTokenSwept(event);

    assert.entityCount('JackpotFunderIncident', 1);
    const id = incidentId(event);
    assert.fieldEquals('JackpotFunderIncident', id, 'kind', 'TOKEN_SWEPT');
    assert.fieldEquals('JackpotFunderIncident', id, 'asset', ASSET.toHexString());
    assert.fieldEquals('JackpotFunderIncident', id, 'to', RECIPIENT.toHexString());
    assert.fieldEquals('JackpotFunderIncident', id, 'amount', '789');
  });
});
