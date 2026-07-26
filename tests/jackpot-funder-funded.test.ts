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
  FundFromMarketSkipped,
  FundedFromMarket,
} from '../generated/BRBJackpotFunder/BRBJackpotFunder';
import {
  handleFundFromMarketSkipped,
  handleFundedFromMarket,
} from '../src/mappings/jackpot-funder';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import { setupTestMarket } from './helpers';

const FUNDER = Address.fromString('0xd990413247611013161a7287d262664df8da7309');
const ASSET = Address.fromString('0xaaaa000000000000000000000000000000000099');

function baseFunderEvent<T extends ethereum.Event>(event: T): T {
  event.address = FUNDER;
  event.parameters = new Array<ethereum.EventParam>();
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

function eventEntityId(event: ethereum.Event): string {
  return event.transaction.hash.concat(bigintToBytes(event.logIndex)).toHexString();
}

describe('BRBJackpotFunder TWAP funding', () => {
  beforeEach(() => {
    clearStore();
  });

  test('FundedFromMarket records a JackpotBuy with the full swap breakdown', () => {
    setupTestMarket();
    const event = baseFunderEvent(changetype<FundedFromMarket>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET)));
    event.parameters.push(
      new ethereum.EventParam(
        'assetSwapped',
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('3000000'))
      )
    );
    event.parameters.push(
      new ethereum.EventParam(
        'brbOut',
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('3000000000000000000'))
      )
    );
    event.parameters.push(
      new ethereum.EventParam(
        'brbToTreasury',
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2500000000000000000'))
      )
    );
    event.parameters.push(
      new ethereum.EventParam(
        'brbBurned',
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('500000000000000000'))
      )
    );
    handleFundedFromMarket(event);

    assert.entityCount('JackpotBuy', 1);
    const id = eventEntityId(event);
    assert.fieldEquals('JackpotBuy', id, 'asset', ASSET.toHexString());
    assert.fieldEquals('JackpotBuy', id, 'assetSwapped', '3000000');
    assert.fieldEquals('JackpotBuy', id, 'brbOut', '3000000000000000000');
    assert.fieldEquals('JackpotBuy', id, 'brbToTreasury', '2500000000000000000');
    assert.fieldEquals('JackpotBuy', id, 'brbBurned', '500000000000000000');
  });

  test('FundedFromMarket for an unknown market creates no entity', () => {
    const event = baseFunderEvent(changetype<FundedFromMarket>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(99)))
    );
    event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET)));
    event.parameters.push(
      new ethereum.EventParam('assetSwapped', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(
      new ethereum.EventParam('brbOut', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(
      new ethereum.EventParam('brbToTreasury', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(
      new ethereum.EventParam('brbBurned', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)))
    );
    handleFundedFromMarket(event);

    assert.entityCount('JackpotBuy', 0);
  });

  test('FundFromMarketSkipped records the skip reason', () => {
    setupTestMarket();
    const event = baseFunderEvent(changetype<FundFromMarketSkipped>(newMockEvent()));
    event.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET)));
    event.parameters.push(
      new ethereum.EventParam('reason', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3)))
    );
    handleFundFromMarketSkipped(event);

    assert.entityCount('JackpotFundingSkip', 1);
    const id = eventEntityId(event);
    assert.fieldEquals('JackpotFundingSkip', id, 'reason', '3');
  });
});
