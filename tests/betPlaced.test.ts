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
import { ChainlinkSetupCompleted, VRFResult } from '../generated/RouletteClean/Game';
import { handleChainlinkSetupCompleted, handleVRFResult } from '../src/mappings/roulette';
import { ROUND_STATUS_PAYOUT } from '../src/helpers/constant';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

const initializeRound = (): void => {
    const chainlinkSetupCompletedEvent = changetype<ChainlinkSetupCompleted>(newMockEvent());
    chainlinkSetupCompletedEvent.parameters = new Array<ethereum.EventParam>();
    chainlinkSetupCompletedEvent.parameters.push(new ethereum.EventParam('subscriptionId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1"))));
    chainlinkSetupCompletedEvent.parameters.push(new ethereum.EventParam('keeperRegistry', ethereum.Value.fromAddress(Address.fromString('0xbbbbedc42dc53842141be8f70df9efe4d08538a4'))));
    chainlinkSetupCompletedEvent.parameters.push(new ethereum.EventParam('keeperRegistrar', ethereum.Value.fromAddress(Address.fromString('0xbbbbedc42dc53842141be8f70df9efe4d08538a4'))));
    chainlinkSetupCompletedEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
    handleChainlinkSetupCompleted(chainlinkSetupCompletedEvent)
}
const initializeBet = (): void => {
  const betPlacedEvent = changetype<BetPlaced>(newMockEvent());
  betPlacedEvent.parameters = new Array<ethereum.EventParam>();
  betPlacedEvent.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString('0xbbbbedc42dc53842141be8f70df9efe4d08538a4'))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("10000000000000000000"))));
  betPlacedEvent.parameters.push(new ethereum.EventParam('data', ethereum.Value.fromBytes(Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"))));

  betPlacedEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  handleBetPlaced(betPlacedEvent);
};

const vrfResult = (): void => {
  const vrfResultEvent = changetype<VRFResult>(newMockEvent());
  vrfResultEvent.parameters = new Array<ethereum.EventParam>();
  vrfResultEvent.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1"))));
  vrfResultEvent.parameters.push(new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("5"))));
  vrfResultEvent.parameters.push(new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromString("7"))));
  vrfResultEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
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
    assert.fieldEquals('RouletteRound', '1', 'status', ROUND_STATUS_PAYOUT)
    // assert.fieldEquals('RouletteBet', '0xbbbbedc42dc53842141be8f70df9efe4d08538a41', 'user', '0xbbbbedc42dc53842141be8f70df9efe4d08538a4');
  });
});
