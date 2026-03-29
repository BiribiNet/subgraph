import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { Deposit, Withdraw, RoundCleaningCompleted } from '../generated/StakedBRB/StakedBRB';
import { handleDeposit, handleWithdraw, handleRoundCleaningCompleted } from '../src/mappings/stakedBRB';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

const GLOBAL_STATE_ID = '0x0000000000000000000000000000000000000001';
const USER_ADDRESS = '0xbbbbedc42dc53842141be8f70df9efe4d08538a4';

const createRoundCleaningCompleted = (
  cleanedRoundId: i32,
  protocolFees: string,
  burnAmount: string,
  jackpotAmount: string,
  timestamp: i32
): void => {
  const ev = changetype<RoundCleaningCompleted>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('cleanedRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(cleanedRoundId)))
  );
  ev.parameters.push(
    new ethereum.EventParam('newRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(cleanedRoundId + 1)))
  );
  ev.parameters.push(
    new ethereum.EventParam('boundaryTimestamp', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(timestamp)))
  );
  const feesTuple = new ethereum.Tuple();
  feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromString(protocolFees)));
  feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromString(burnAmount)));
  feesTuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromString(jackpotAmount)));
  ev.parameters.push(new ethereum.EventParam('fees', ethereum.Value.fromTuple(feesTuple)));
  ev.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleRoundCleaningCompleted(ev);
};

const initializeRound = (timestamp: i32 = 1000000): void => {
  createRoundCleaningCompleted(0, '0', '0', '0', timestamp);
};

const createDeposit = (user: string, assets: string, shares: string, timestamp: i32): void => {
  const depositEvent = changetype<Deposit>(newMockEvent());
  depositEvent.parameters = new Array<ethereum.EventParam>();
  depositEvent.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(user)))
  );
  depositEvent.parameters.push(
    new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(user)))
  );
  depositEvent.parameters.push(
    new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(assets)))
  );
  depositEvent.parameters.push(
    new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(shares)))
  );
  depositEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  depositEvent.block.timestamp = BigInt.fromI32(timestamp);
  depositEvent.block.number = BigInt.fromI32(timestamp / 100);
  depositEvent.logIndex = BigInt.fromI32(0);
  handleDeposit(depositEvent);
};

const createWithdraw = (user: string, assets: string, shares: string, timestamp: i32): void => {
  const withdrawEvent = changetype<Withdraw>(newMockEvent());
  withdrawEvent.parameters = new Array<ethereum.EventParam>();
  withdrawEvent.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(user)))
  );
  withdrawEvent.parameters.push(
    new ethereum.EventParam('receiver', ethereum.Value.fromAddress(Address.fromString(user)))
  );
  withdrawEvent.parameters.push(
    new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(user)))
  );
  withdrawEvent.parameters.push(
    new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(assets)))
  );
  withdrawEvent.parameters.push(
    new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(shares)))
  );
  withdrawEvent.address = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
  withdrawEvent.block.timestamp = BigInt.fromI32(timestamp);
  withdrawEvent.block.number = BigInt.fromI32(timestamp / 100);
  withdrawEvent.logIndex = BigInt.fromI32(0);
  handleWithdraw(withdrawEvent);
};

describe('Cost Basis Calculation Tests', () => {
  beforeEach(() => {
    clearStore();
    initializeRound();
  });

  test('Single deposit: cumulative values match deposit', () => {
    // User deposits 10 BRB, gets 10 sBRB (1:1 ratio)
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalStaked', '10000000000000000000');
  });

  test('Multiple deposits: cumulative values sum correctly', () => {
    // First deposit: 10 BRB for 10 sBRB
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Second deposit: 5 BRB for 5 sBRB (still 1:1 ratio)
    createDeposit(USER_ADDRESS, '5000000000000000000', '5000000000000000000', 1000100);
    
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '15000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '15000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalStaked', '15000000000000000000');
  });

  test('Deposit with different ratio: cumulative values track correctly', () => {
    // First deposit: 10 BRB for 10 sBRB (1:1)
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Second deposit: 5 BRB for 4.17 sBRB (vault has grown, ratio is ~1.2:1)
    // Using exact values: 5 BRB / 1.2 = 4.166666... sBRB
    // Represented as: 4166666666666666666 (with 18 decimals)
    createDeposit(USER_ADDRESS, '5000000000000000000', '4166666666666666666', 1000100);
    
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '15000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '14166666666666666666');
    assert.fieldEquals('User', USER_ADDRESS, 'totalStaked', '15000000000000000000');
  });

  test('Partial withdrawal: cost basis removed proportionally', () => {
    // Deposit: 10 BRB for 10 sBRB
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Withdraw: 5 sBRB (half the shares)
    // Expected: costBasisRemoved = (5 × 10 × 10^18) / 10 / 10^18 = 5 BRB
    createWithdraw(USER_ADDRESS, '5000000000000000000', '5000000000000000000', 1000100);
    
    // Remaining: 5 sBRB with cost basis of 5 BRB
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '5000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '5000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalUnstaked', '5000000000000000000');
  });

  test('Withdrawal after multiple deposits: cost basis calculated correctly', () => {
    // First deposit: 10 BRB for 10 sBRB
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Second deposit: 5 BRB for 5 sBRB
    createDeposit(USER_ADDRESS, '5000000000000000000', '5000000000000000000', 1000100);
    
    // Total: 15 BRB for 15 sBRB, average cost = 1 BRB per sBRB
    
    // Withdraw: 6 sBRB
    // Expected: costBasisRemoved = (6 × 15 × 10^18) / 15 / 10^18 = 6 BRB
    createWithdraw(USER_ADDRESS, '6000000000000000000', '6000000000000000000', 1000200);
    
    // Remaining: 9 sBRB with cost basis of 9 BRB
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '9000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '9000000000000000000');
  });

  test('Withdrawal with precision: handles non-integer ratios correctly', () => {
    // Deposit: 10 BRB for 10 sBRB
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Second deposit: 5 BRB for 4.17 sBRB (ratio ~1.2:1)
    createDeposit(USER_ADDRESS, '5000000000000000000', '4166666666666666666', 1000100);
    
    // Total: 15 BRB for 14.166666... sBRB
    // Average cost per share = 15 / 14.166666... = ~1.0588 BRB per sBRB
    
    // Withdraw: 5 sBRB
    // Expected: costBasisRemoved = (5 × 15 × 10^18) / 14166666666666666666 / 10^18
    // = (75 × 10^18) / 14166666666666666666
    // = 5294117647058823529 (scaled)
    // / 10^18 = 5.294117647058823529 BRB
    // Truncated to BigInt: 5294117647058823529
    createWithdraw(USER_ADDRESS, '5294117647058823529', '5000000000000000000', 1000200);
    
    // Remaining shares: 14.166666... - 5 = 9.166666... sBRB
    // Remaining cost basis: 15 - 5.294117647058823529 = 9.705882352941176471 BRB
    // Truncated: 9705882352941176471
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '9166666666666666666');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '9705882352941176471');
  });

  test('Complete withdrawal: resets cumulative values to zero', () => {
    // Deposit: 10 BRB for 10 sBRB
    createDeposit(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000000);
    
    // Withdraw all: 10 sBRB
    createWithdraw(USER_ADDRESS, '10000000000000000000', '10000000000000000000', 1000100);
    
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '0');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '0');
  });

  test('Precision factor calculation: verifies scaled math with non-integer division', () => {
    // Test case: Deposit 1000 BRB, get 333 sBRB (vault ratio ~3:1)
    // This creates a scenario where division doesn't result in whole numbers
    createDeposit(USER_ADDRESS, '1000000000000000000000', '333000000000000000000', 1000000);
    
    // Verify initial cumulative values
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '1000000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '333000000000000000000');
    
    // Withdraw 100 sBRB
    // Manual calculation to verify:
    // costBasisRemoved = ((100 × 1000 × 10^18) / 333) / 10^18
    // = (100000000000000000000000 × 10^18) / 333 / 10^18
    // = 300300300300300300300300300300300300 / 10^18
    // = 300300300300300300 (truncated, representing ~300.3003 BRB)
    // 
    // So remaining cost basis = 1000 - 300.3003 = 699.6996 BRB
    // = 699699699699699700000 (in wei, truncated)
    createWithdraw(USER_ADDRESS, '300300300300300300000', '100000000000000000000', 1000100);
    
    // Verify remaining shares
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositShares', '233000000000000000000');
    
    // Verify remaining cost basis
    // Calculation: costBasisRemoved = ((100 × 1000 × 10^18) / 333) / 10^18
    // Step by step:
    // 1. 100 × 1000 × 10^18 = 100000000000000000000000000000000000000000000000000000000000
    // 2. / 333 = 300300300300300300300300300300300300300 (truncated)
    // 3. / 10^18 = 300300300300300300300 (truncated)
    // Remaining: 1000 - 300.3003003003003003 = 699.6996996996996997 BRB
    // In wei: 699699699699699699700
    // Note: The double truncation (once in step 2, once in step 3) results in this exact value
    assert.fieldEquals('User', USER_ADDRESS, 'cumulativeDepositValue', '699699699699699699700');
  });
});
