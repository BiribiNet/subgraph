import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { PayoutProgress, RoundResolved, VrfRequested } from '../generated/RouletteEngine/Game';
import { Transfer as BrbTransfer } from '../generated/BRBToken/BRB';
import { CallFailed } from '../generated/AutomationReceiver/AutomationReceiver';
import { handleCallFailed } from '../src/mappings/automation-receiver';
import {
  handlePayoutProgress,
  handleRoundResolved,
  handleVrfRequested,
} from '../src/mappings/roulette';
import { handleTransfer as handleBrbTransfer } from '../src/mappings/brb';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import {
  BRB_TOKEN,
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_BANK,
  createRoundForTests,
  emitBetRecorded,
  emitBrbBurnInTx,
  emitJackpotFundedInTx,
  encodeBetLegs,
  globalRoundIdHex,
  mockBrbTotalSupply,
  setupBrbTestMarket,
  setupSecondTestMarket,
  setupTestMarket,
  testRoundId,
} from './helpers';

const ENGINE = Address.fromString('0x7eb8110d9e84d3c32fa6468d13ea2bc81544acf1');
const TIMESTAMP = 1_000_000;

/**
 * Verbatim `betData` from BetPlaced on Arbitrum Sepolia
 * (tx 0x16d3eb29e7baf5c5389774bd20d12379c9209e37af5c480c1efc00bf52c7014e, global round 164):
 * 1000 DAI on BLACK (type 9) + 1000 DAI on ODD (type 10). Kept as raw bytes rather than re-encoded
 * so the decoder is measured against what the chain actually emits.
 */
const ONCHAIN_BET_DATA = Bytes.fromHexString(
  '0x' +
    '0000000000000000000000000000000000000000000000000000000000000060' +
    '00000000000000000000000000000000000000000000000000000000000000c0' +
    '0000000000000000000000000000000000000000000000000000000000000120' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    '000000000000000000000000000000000000000000000000000000000000000a' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '00000000000000000000000000000000000000000000003635c9adc5dea00000' +
    '00000000000000000000000000000000000000000000003635c9adc5dea00000'
);

function emitPayoutProgress(
  globalRoundId: i32,
  marketId: i32,
  fromCursor: i32,
  toCursor: i32,
  paidAmount: string
): void {
  const event = changetype<PayoutProgress>(newMockEvent());
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'globalRoundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(globalRoundId))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(marketId)))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'fromCursor',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fromCursor))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('toCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(toCursor)))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'paidAmount',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(paidAmount))
    )
  );
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  handlePayoutProgress(event);
}

function emitVrfRequested(globalRoundId: i32): void {
  const event = changetype<VrfRequested>(newMockEvent());
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'newRoundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(globalRoundId))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('requestId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(42)))
  );
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  handleVrfRequested(event);
}

function emitRoundResolved(globalRoundId: i32): void {
  const event = changetype<RoundResolved>(newMockEvent());
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'roundId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(globalRoundId))
    )
  );
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  handleRoundResolved(event);
}

function emitCallFailed(transactionHash: Bytes, logIndex: i32): void {
  const event = changetype<CallFailed>(newMockEvent());
  event.address = Address.fromString('0xfda0edcbcf2c6360279cf10ec079d56d43795a86');
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'target',
      ethereum.Value.fromAddress(Address.fromString('0xad1f181ad88aee13a6643104941ecea2b963c2d7'))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'selector',
      ethereum.Value.fromFixedBytes(Bytes.fromHexString('0x4585e33b'))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('reason', ethereum.Value.fromBytes(Bytes.fromHexString('0xb1aeab08')))
  );
  event.transaction.hash = transactionHash;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  event.block.number = BigInt.fromI32(10_000);
  handleCallFailed(event);
}

/** A BRB transfer out of the bank — a winner payout and a protocol fee look identical here. */
function emitBankTransfer(to: string, value: string, transactionHash: Bytes, logIndex: i32): void {
  mockBrbTotalSupply();
  const event = changetype<BrbTransfer>(newMockEvent());
  event.address = BRB_TOKEN;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(TEST_BANK)));
  event.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to)))
  );
  event.parameters.push(
    new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value)))
  );
  event.transaction.hash = transactionHash;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  event.block.number = BigInt.fromI32(10_000);
  handleBrbTransfer(event);
}

describe('betData decoding', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('records every leg of a real on-chain payload', () => {
    emitBetRecorded(DEFAULT_USER, '2000000000000000000000', ONCHAIN_BET_DATA, 164);

    const betId = DEFAULT_USER + testRoundId(164).slice(2);
    assert.fieldEquals('RouletteBet', betId, 'betTypes', '[BLACK, ODD]');
    assert.fieldEquals('RouletteBet', betId, 'numbers', '[0, 0]');
    assert.fieldEquals(
      'RouletteBet',
      betId,
      'amounts',
      '[1000000000000000000000, 1000000000000000000000]'
    );
  });

  test('feeds the round exposure buckets instead of collapsing onto straight-0', () => {
    emitBetRecorded(DEFAULT_USER, '2000000000000000000000', ONCHAIN_BET_DATA, 164);

    assert.fieldEquals(
      'RouletteRound',
      testRoundId(164),
      'blackBetsSum',
      '1000000000000000000000'
    );
    assert.fieldEquals('RouletteRound', testRoundId(164), 'oddBetsSum', '1000000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(164), 'maxStraightBet', '0');
    // 110% safety buffer over the worst even-money pair: (1000 * 2) + (1000 * 2).
    assert.fieldEquals('RouletteRound', testRoundId(164), 'maxBetAmount', '4400000000000000000000');
  });

  test('keeps a leg with an out-of-range number out of the fixed-size buckets', () => {
    const betData = encodeBetLegs(
      [BigInt.fromI32(1), BigInt.fromI32(8)],
      [BigInt.fromI32(99), BigInt.zero()],
      [BigInt.fromString('1000000000000000000'), BigInt.fromString('2000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '3000000000000000000', betData, 5);

    assert.fieldEquals('RouletteRound', testRoundId(5), 'maxStraightBet', '0');
    assert.fieldEquals('RouletteRound', testRoundId(5), 'redBetsSum', '2000000000000000000');
  });
});

describe('GlobalRound.participantMarketCount', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    setupSecondTestMarket();
  });

  test('counts each market that opened a slice of the round', () => {
    const betData = encodeBetLegs(
      [BigInt.fromI32(8)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 3, 1);
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 3, 2);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(3), 'participantMarketCount', '2');
  });

  test('does not double count a market that bets twice in one round', () => {
    const betData = encodeBetLegs(
      [BigInt.fromI32(8)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 4, 1, TIMESTAMP, 0);
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 4, 1, TIMESTAMP, 1);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(4), 'participantMarketCount', '1');
  });
});

describe('GlobalState.totalStakerRevenue', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('survives the round resolution that produced it', () => {
    const betData = encodeBetLegs(
      [BigInt.fromI32(8)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 9);
    // 3% jackpot + 2% infra on a fully lost round leaves the stakers' 95%.
    emitJackpotFundedInTx(9, 1, '30000000000000000', Bytes.fromHexString('0xfeed01'), 0);
    emitRoundResolved(9);

    assert.fieldEquals('RouletteRound', testRoundId(9), 'stakersRevenue', '970000000000000000');
    assert.fieldEquals(
      'GlobalState',
      GLOBAL_STATE_ID,
      'totalStakerRevenue',
      '970000000000000000'
    );
  });
});

describe('BRB burn attribution', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    setupSecondTestMarket();
  });

  test('books the burn on the market the engine names, not the previous round', () => {
    createRoundForTests(11, TIMESTAMP, 1);
    createRoundForTests(11, TIMESTAMP, 2);
    const txHash = Bytes.fromHexString('0xbeef01');

    // Settlement order inside one transaction: the funder burns, then the engine names the round.
    emitBrbBurnInTx('25000000000000000', txHash, 0);
    emitJackpotFundedInTx(11, 2, '150000000000000000', txHash, 1);

    assert.fieldEquals('RouletteRound', testRoundId(11, 2), 'roundBurnAmount', '25000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(11, 1), 'roundBurnAmount', '0');
  });

  test('pairs each burn with its own market when two settle in one transaction', () => {
    createRoundForTests(12, TIMESTAMP, 1);
    createRoundForTests(12, TIMESTAMP, 2);
    const txHash = Bytes.fromHexString('0xbeef02');

    emitBrbBurnInTx('10000000000000000', txHash, 0);
    emitJackpotFundedInTx(12, 1, '60000000000000000', txHash, 1);
    emitBrbBurnInTx('40000000000000000', txHash, 2);
    emitJackpotFundedInTx(12, 2, '240000000000000000', txHash, 3);

    assert.fieldEquals('RouletteRound', testRoundId(12, 1), 'roundBurnAmount', '10000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(12, 2), 'roundBurnAmount', '40000000000000000');
  });

  test('leaves a burn no roulette settlement claimed unattributed', () => {
    createRoundForTests(13, TIMESTAMP, 1);
    emitBrbBurnInTx('5000000000000000', Bytes.fromHexString('0xbeef03'), 0);

    assert.fieldEquals('RouletteRound', testRoundId(13, 1), 'roundBurnAmount', '0');
    assert.entityCount('BRBBurn', 1);
  });
});

describe('GlobalState.brbTotalSupply', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('seeds from the token when the genesis mint predates the start block', () => {
    mockBrbTotalSupply('3000000000000000000000000');

    // First BRB event ever seen is a burn, not the mint — exactly the live deployment's situation.
    emitBrbBurnInTx('1000000000000000000', Bytes.fromHexString('0xbeef04'), 0);

    assert.fieldEquals(
      'GlobalState',
      GLOBAL_STATE_ID,
      'brbTotalSupply',
      '2999999000000000000000000'
    );
  });
});

describe('RouletteRound.currentPayoutsCount', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('sums the rows every lane settled instead of taking a per-lane cursor', () => {
    createRoundForTests(14, TIMESTAMP, 1);

    // Two lanes, each with its own cursor starting at 0: one row, then two rows.
    emitPayoutProgress(14, 1, 0, 1, '2000000000000000000');
    emitPayoutProgress(14, 1, 0, 2, '38000000000000000000');

    assert.fieldEquals('RouletteRound', testRoundId(14), 'currentPayoutsCount', '3');
    assert.fieldEquals('RouletteRound', testRoundId(14), 'totalPayouts', '40000000000000000000');
  });
});

describe('payout attribution timing', () => {
  beforeEach(() => {
    clearStore();
    setupBrbTestMarket();
  });

  test('credits a settlement transfer that lands before the round flips to PAYOUT', () => {
    const betData = encodeBetLegs(
      [BigInt.fromI32(8)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 15);
    emitVrfRequested(15);

    // The bank pays the winner first; PayoutProgress only follows later in the same transaction.
    emitBankTransfer(DEFAULT_USER, '2000000000000000000', Bytes.fromHexString('0xbeef05'), 1);

    const betId = DEFAULT_USER + testRoundId(15).slice(2);
    assert.entityCount('PayoutTransaction', 1);
    assert.fieldEquals('RouletteBet', betId, 'won', 'true');
    assert.fieldEquals('RouletteBet', betId, 'actualPayout', '2000000000000000000');
  });
});

describe('GlobalState.currentGlobalRound', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('points at a round that exists once the previous one resolved', () => {
    createRoundForTests(20, TIMESTAMP, 1);
    emitRoundResolved(20);

    // Non-null in the schema: an unsaved next round made every query selecting through this
    // pointer fail outright until that round's first bet created the entity.
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '21');
    assert.fieldEquals('GlobalRound', globalRoundIdHex(21), 'roundNumber', '21');
  });

  test('attributes a failed automation call to the round between two rounds', () => {
    createRoundForTests(21, TIMESTAMP, 1);
    emitRoundResolved(21);

    // The scheduler keeps polling in the idle window before the next round's first bet.
    emitCallFailed(Bytes.fromHexString('0xfa11'), 0);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'failedAutomationCalls', '1');
    assert.fieldEquals('GlobalRound', globalRoundIdHex(22), 'failedAutomationCalls', '1');
  });
});

describe('protocol fee recipients are not winners', () => {
  beforeEach(() => {
    clearStore();
    setupBrbTestMarket();
  });

  test('does not credit the infrastructure fee as a payout to a bettor', () => {
    const globalState = getOrCreateGlobalState();
    // On testnet the infra recipient and a player are the same wallet, which is what exposed this.
    globalState.infraRecipient = Bytes.fromHexString(DEFAULT_USER);
    globalState.save();

    const betData = encodeBetLegs(
      [BigInt.fromI32(9)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 30);
    emitVrfRequested(30);

    // `_collectMarketFees` pays the fee straight out of the bank, exactly like a winner payout.
    emitBankTransfer(DEFAULT_USER, '20000000000000000', Bytes.fromHexString('0xfee1'), 1);

    const betId = DEFAULT_USER + testRoundId(30).slice(2);
    assert.entityCount('PayoutTransaction', 0);
    assert.fieldEquals('RouletteBet', betId, 'won', 'false');
    assert.fieldEquals('RouletteBet', betId, 'actualPayout', '0');
  });

  test('still credits a genuine payout to a bettor who holds no protocol role', () => {
    const globalState = getOrCreateGlobalState();
    globalState.infraRecipient = Bytes.fromHexString(
      '0x00000000000000000000000000000000000000fe'
    );
    globalState.save();

    const betData = encodeBetLegs(
      [BigInt.fromI32(9)],
      [BigInt.zero()],
      [BigInt.fromString('1000000000000000000')]
    );
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', betData, 31);
    emitVrfRequested(31);
    emitBankTransfer(DEFAULT_USER, '2000000000000000000', Bytes.fromHexString('0xfee2'), 1);

    const betId = DEFAULT_USER + testRoundId(31).slice(2);
    assert.entityCount('PayoutTransaction', 1);
    assert.fieldEquals('RouletteBet', betId, 'won', 'true');
    assert.fieldEquals('RouletteBet', betId, 'actualPayout', '2000000000000000000');
  });
});
