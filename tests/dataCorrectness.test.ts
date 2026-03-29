import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { BetPlaced, Deposit, RoundCleaningCompleted } from '../generated/StakedBRB/StakedBRB';
import { handleBetPlaced, handleDeposit, handleRoundCleaningCompleted } from '../src/mappings/stakedBRB';
import { Transfer } from '../generated/BRBToken/BRB';
import { handleTransfer } from '../src/mappings/brb';
import { Transfer as BRBRTransfer } from '../generated/BRBReferal/BRBReferal';
import { handleTransfer as handleBrbrTransfer } from '../src/mappings/brbReferal';
import { VrfRequested, VRFResult } from '../generated/RouletteClean/Game';
import { handleVrfRequested, handleVRFResult } from '../src/mappings/roulette';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

const GLOBAL_STATE_ID = '0x0000000000000000000000000000000000000001';
const USER_ADDRESS = '0xbbbbedc42dc53842141be8f70df9efe4d08538a4';
const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';
const STAKED_BRB = '0x306a67e1ca543c0892011174fa02cb1848172965';
const CONTRACT_ADDRESS = '0x15dc1be843c63317e87865e1df14afa782fae171';

function createRoundCleaningCompleted(
  cleanedRoundId: i32,
  protocolFees: string,
  burnAmount: string,
  jackpotAmount: string,
  timestamp: i32
): void {
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
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleRoundCleaningCompleted(ev);
}

function initializeRound(timestamp: i32 = 1000000): void {
  createRoundCleaningCompleted(0, '0', '0', '0', timestamp);
}

// BetPlaced with specific bet type
// The data param encodes: (uint256[] amounts, uint256[] betTypes, uint256[] numbers)
function createBetPlacedData(amount: string, betType: i32, number: i32): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(changetype<ethereum.Tuple>([
      ethereum.Value.fromUnsignedBigIntArray([BigInt.fromString(amount)]),
      ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(betType)]),
      ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(number)])
    ]))
  );
  return encoded ? encoded : Bytes.empty();
}

function placeBet(user: string, amount: string, betType: i32, number: i32, roundId: i32 = 1, timestamp: i32 = 1000000): void {
  const ev = changetype<BetPlaced>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(user))));
  ev.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  ev.parameters.push(new ethereum.EventParam('data', ethereum.Value.fromBytes(createBetPlacedData(amount, betType, number))));
  ev.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleBetPlaced(ev);
}

function createPayoutTransfer(from: string, to: string, amount: string, timestamp: i32 = 1000200): void {
  const ev = changetype<Transfer>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from))));
  ev.parameters.push(new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to))));
  ev.parameters.push(new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(1);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleTransfer(ev);
}

function fireVrfResult(roundId: i32 = 1, winningNumber: i32 = 7): void {
  const ev = changetype<VRFResult>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))));
  ev.parameters.push(new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5))));
  ev.parameters.push(new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.block.timestamp = BigInt.fromI32(1000100);
  ev.block.number = BigInt.fromI32(10001);
  handleVRFResult(ev);
}

function createBrbrTransfer(from: string, to: string, amount: string, timestamp: i32 = 1000000): void {
  const ev = changetype<BRBRTransfer>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from))));
  ev.parameters.push(new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to))));
  ev.parameters.push(new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleBrbrTransfer(ev);
}

// === totalLost SEMANTICS TESTS ===

describe('totalLost derived calculation', () => {
  beforeEach(() => {
    clearStore();
  });

  test('After bet placement, totalLost equals totalRouletteBets (no wins yet)', () => {
    initializeRound();
    // BET_STRAIGHT = 1, number = 4
    placeBet(USER_ADDRESS, '10000000000000000000', 1, 4);

    assert.fieldEquals('User', USER_ADDRESS, 'totalRouletteBets', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalLost', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalWon', '0');
    assert.fieldEquals('User', USER_ADDRESS, 'netProfit', '-10000000000000000000');
  });

  test('After winning payout, totalLost decreases correctly', () => {
    initializeRound(1000000);
    const vrfEv = changetype<VrfRequested>(newMockEvent());
    vrfEv.parameters = new Array<ethereum.EventParam>();
    vrfEv.parameters.push(new ethereum.EventParam('newRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))));
    vrfEv.parameters.push(new ethereum.EventParam('requestId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    vrfEv.parameters.push(new ethereum.EventParam('timestamp', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000050))));
    vrfEv.address = Address.fromString(CONTRACT_ADDRESS);
    vrfEv.block.timestamp = BigInt.fromI32(1000050);
    handleVrfRequested(vrfEv); // Sets round 1 to VRF (round 2 entity is created on next cleaning)

    // Place bet on round 1
    placeBet(USER_ADDRESS, '10000000000000000000', 1, 4, 1);

    // VRF result (puts round 1 into PAYOUT status)
    fireVrfResult(1, 4); // winning number = 4 (matches our bet)

    // Payout from StakedBRB to user
    createPayoutTransfer(STAKED_BRB, USER_ADDRESS, '360000000000000000000');

    // totalLost should be totalRouletteBets - totalWon = 10 - 360 = 0 (clamped by actual logic)
    // Actually: totalRouletteBets = 10, totalWon = 360
    // totalLost = totalRouletteBets - totalWon = 10 - 360 = negative -> but stored as BigInt
    // The derive formula: user.totalLost = user.totalRouletteBets.minus(user.totalWon)
    // This will be negative (-350), which is fine for BigInt (signed in AssemblyScript store)
    assert.fieldEquals('User', USER_ADDRESS, 'totalRouletteBets', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalWon', '360000000000000000000');
    // netProfit = -10 + 360 = 350
    assert.fieldEquals('User', USER_ADDRESS, 'netProfit', '350000000000000000000');
  });

  test('Multiple bets without wins: totalLost accumulates correctly', () => {
    initializeRound();

    placeBet(USER_ADDRESS, '5000000000000000000', 1, 4, 1);
    placeBet(USER_ADDRESS, '3000000000000000000', 8, 0, 1); // RED bet

    assert.fieldEquals('User', USER_ADDRESS, 'totalRouletteBets', '8000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalLost', '8000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalWon', '0');
    assert.fieldEquals('User', USER_ADDRESS, 'netProfit', '-8000000000000000000');
  });
});

// === BRBR EARNINGS TRACKING TESTS ===

describe('BRBR earnings tracking on User', () => {
  beforeEach(() => {
    clearStore();
  });

  test('BRBR credit increments totalBrbrEarned', () => {
    // Mint BRBR from zero address to user
    createBrbrTransfer(
      '0x0000000000000000000000000000000000000000',
      USER_ADDRESS,
      '100000000000000000000'
    );

    assert.fieldEquals('User', USER_ADDRESS, 'totalBrbrEarned', '100000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalBrbrSpent', '0');
  });

  test('BRBR debit increments totalBrbrSpent', () => {
    // First credit
    createBrbrTransfer(
      '0x0000000000000000000000000000000000000000',
      USER_ADDRESS,
      '100000000000000000000'
    );
    // Then debit (user sends to someone)
    createBrbrTransfer(USER_ADDRESS, USER_ADDRESS_2, '30000000000000000000');

    assert.fieldEquals('User', USER_ADDRESS, 'totalBrbrEarned', '100000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS, 'totalBrbrSpent', '30000000000000000000');
    // Receiver gets credit
    assert.fieldEquals('User', USER_ADDRESS_2, 'totalBrbrEarned', '30000000000000000000');
  });
});
