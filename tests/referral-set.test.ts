import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { ReferralSet } from '../generated/RouletteEngine/Game';
import { handleReferralSet } from '../src/mappings/roulette';
import { TEST_ENGINE } from './helpers';

const PLAYER = '0xaaaa000000000000000000000000000000000001';
const REFERRER = '0xbbbb000000000000000000000000000000000002';

describe('ReferralSet', () => {
  beforeEach(() => {
    clearStore();
  });

  test('binds referrer on player and is immutable', () => {
    const ev = changetype<ReferralSet>(newMockEvent());
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(
      new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(PLAYER)))
    );
    ev.parameters.push(
      new ethereum.EventParam('referrer', ethereum.Value.fromAddress(Address.fromString(REFERRER)))
    );
    ev.block.timestamp = BigInt.fromI32(1_000_000);
    handleReferralSet(ev);

    assert.fieldEquals('User', PLAYER, 'referrer', REFERRER);
    assert.fieldEquals('User', PLAYER, 'referralSetAt', '1000000');

    const second = changetype<ReferralSet>(newMockEvent());
    second.address = TEST_ENGINE;
    second.parameters = new Array<ethereum.EventParam>();
    second.parameters.push(
      new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(PLAYER)))
    );
    second.parameters.push(
      new ethereum.EventParam(
        'referrer',
        ethereum.Value.fromAddress(Address.fromString('0xcccc000000000000000000000000000000000003'))
      )
    );
    second.block.timestamp = BigInt.fromI32(1_000_100);
    handleReferralSet(second);

    assert.fieldEquals('User', PLAYER, 'referrer', REFERRER);
  });
});
