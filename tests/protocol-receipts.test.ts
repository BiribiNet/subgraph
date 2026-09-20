import { assert, clearStore, beforeEach, test, newMockEvent } from 'matchstick-as';
import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { RoulettePayment, JackpotPayment } from '../generated/RouletteEngine/Game';
import { handleRoulettePayment, handleJackpotPayment } from '../src/mappings/roulette';

const wallet = Address.fromString('0x1111111111111111111111111111111111111111');
const token = Address.fromString('0x2222222222222222222222222222222222222222');
beforeEach(() => clearStore());
test('Explicit roulette receipts remain evidence, without incrementing legacy totals again', () => {
  const event = changetype<RoulettePayment>(newMockEvent());
  event.parameters = [
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))),
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
    new ethereum.EventParam('recipient', ethereum.Value.fromAddress(wallet)),
    new ethereum.EventParam('token', ethereum.Value.fromAddress(token)),
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(360))),
  ];
  handleRoulettePayment(event);
  assert.entityCount('ProtocolPaymentReceipt', 1);
  assert.entityCount('PayoutTransaction', 0);
  assert.entityCount('MarketAccountingStat', 0);
  assert.fieldEquals('ProtocolPaymentReceipt', event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString(), 'marketId', '1');
});
test('Global jackpot receipts do not invent a market attribution', () => {
  const event = changetype<JackpotPayment>(newMockEvent());
  event.parameters = [
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))),
    new ethereum.EventParam('recipient', ethereum.Value.fromAddress(wallet)),
    new ethereum.EventParam('token', ethereum.Value.fromAddress(token)),
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(900))),
  ];
  handleJackpotPayment(event);
  assert.entityCount('ProtocolPaymentReceipt', 1);
  assert.entityCount('JackpotPayout', 0);
  assert.fieldEquals('ProtocolPaymentReceipt', event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString(), 'kind', 'JACKPOT');
});
