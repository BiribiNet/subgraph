import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { BetPlaced } from '../generated/StakedBRB/StakedBRB';
import { handleBetPlaced } from '../src/mappings/stakedBRB';

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

const initializeBet = (): void => {
  const betPlacedEvent = changetype<BetPlaced>(newMockEvent());
  betPlacedEvent.parameters = new Array<ethereum.EventParam>();
  betPlacedEvent.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString('0xbbbbedc42dc53842141be8f70df9efe4d08538a4'))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("10000000000000000000"))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('data', ethereum.Value.fromBytes(Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"))));

  betPlacedEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  handleBetPlaced(betPlacedEvent);
};
describe('RouletteBet tests', () => {
  beforeEach(() => {
    clearStore();
  });

  test('RouletteBet initialized', () => {
    initializeBet();
    assert.entityCount('RouletteBet', 1);
    // assert.fieldEquals('RouletteBet', '0xbbbbedc42dc53842141be8f70df9efe4d08538a41', 'user', '0xbbbbedc42dc53842141be8f70df9efe4d08538a4');
  });
});
