import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { assert, describe, newMockEvent, test } from 'matchstick-as';
import { withdrawalFeeFromReceipt } from '../src/helpers/withdrawal-fee';

const BANK = Address.fromString('0x1111000000000000000000000000000000000001');
const ASSET = Address.fromString('0x2222000000000000000000000000000000000002');
const USER = Address.fromString('0x3333000000000000000000000000000000000003');
const INFRA = Address.fromString('0x4444000000000000000000000000000000000004');
const TRANSFER = Bytes.fromHexString('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');

function topic(address: Address): Bytes {
  return Bytes.fromHexString('0x000000000000000000000000' + address.toHexString().slice(2));
}
function transfer(token: Address, from: Address, to: Address, value: i32): ethereum.Log {
  const data = ethereum.encode(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)))!;
  return new ethereum.Log(token, [TRANSFER, topic(from), topic(to)], data,
    Bytes.empty(), Bytes.empty(), Bytes.empty(), BigInt.zero(), BigInt.zero(), BigInt.zero(), '', null);
}
function marker(): ethereum.Log {
  return new ethereum.Log(BANK, [], Bytes.empty(), Bytes.empty(), Bytes.empty(), Bytes.empty(),
    BigInt.zero(), BigInt.zero(), BigInt.zero(), '', null);
}
function eventFor(logs: ethereum.Log[], position: i32): ethereum.Event {
  const event = newMockEvent();
  event.address = BANK;
  event.logIndex = BigInt.fromI32(position);
  for (let i = 0; i < logs.length; i++) logs[i].logIndex = BigInt.fromI32(i);
  event.receipt = new ethereum.TransactionReceipt(event.transaction.hash, BigInt.zero(),
    Bytes.empty(), BigInt.zero(), BigInt.zero(), BigInt.zero(), Address.zero(), logs,
    BigInt.fromI32(1), Bytes.empty(), Bytes.empty());
  return event;
}
function fee(event: ethereum.Event, paid: i32, receiver: Address = USER): BigInt {
  return withdrawalFeeFromReceipt(event, USER, receiver, BigInt.fromI32(paid), BigInt.fromI32(50), ASSET, INFRA);
}

describe('Mainnet withdrawal fees are actual transfers, separate from net payments', () => {
  test('two queued withdrawals isolate their own fee and exclude settlement transfers', () => {
    const logs = [transfer(ASSET, BANK, INFRA, 19), marker(),
      transfer(ASSET, BANK, USER, 49), transfer(ASSET, BANK, INFRA, 1),
      transfer(BANK, USER, Address.zero(), 50), marker(),
      transfer(ASSET, BANK, USER, 99), transfer(ASSET, BANK, INFRA, 1),
      transfer(BANK, USER, Address.zero(), 50), marker()];
    assert.bigIntEquals(fee(eventFor(logs, 5), 49), BigInt.fromI32(1));
    assert.bigIntEquals(fee(eventFor(logs, 9), 99), BigInt.fromI32(1));
  });
  test('equal net and fee sent to infra are still two separate transfers', () => {
    const logs = [transfer(ASSET, BANK, INFRA, 1), transfer(ASSET, BANK, INFRA, 1),
      transfer(BANK, USER, Address.zero(), 50), marker()];
    assert.bigIntEquals(fee(eventFor(logs, 3), 1, INFRA), BigInt.fromI32(1));
  });
  test('a failed fee transfer is not deducted, even when receiver is infra', () => {
    const logs = [marker(), transfer(ASSET, BANK, INFRA, 1),
      transfer(BANK, USER, Address.zero(), 50), marker()];
    assert.bigIntEquals(fee(eventFor(logs, 3), 1, INFRA), BigInt.zero());
  });
  test('fee-only dust withdrawals deduct the actual amount', () => {
    const logs = [transfer(ASSET, BANK, INFRA, 7), transfer(BANK, USER, Address.zero(), 50), marker()];
    assert.bigIntEquals(fee(eventFor(logs, 2), 0), BigInt.fromI32(7));
  });
  test('a failed fee-only transfer leaves assets in the vault', () => {
    const logs = [marker(), transfer(BANK, USER, Address.zero(), 50), marker()];
    assert.bigIntEquals(fee(eventFor(logs, 2), 0), BigInt.zero());
  });
  test('cancellations and skipped withdrawals have no fee', () => {
    const event = newMockEvent();
    assert.bigIntEquals(withdrawalFeeFromReceipt(event, USER, USER, BigInt.zero(), BigInt.zero(), ASSET, INFRA), BigInt.zero());
  });
  test('a payment in another token cannot count as a fee', () => {
    const logs = [transfer(BANK, BANK, USER, 49), transfer(BANK, BANK, INFRA, 1),
      transfer(BANK, USER, Address.zero(), 50), marker()];
    fee(eventFor(logs, 3), 49);
  }, true);
  test('a missing receipt fails instead of guessing a fee', () => {
    fee(newMockEvent(), 49);
  }, true);
});
