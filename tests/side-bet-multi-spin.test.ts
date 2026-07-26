import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import { SideBet } from '../generated/schema';
import {
  observeSideBetSpinsForRound,
  registerSideBetForRoundWatch,
} from '../src/helpers/side-bet-vrf';
import { globalRoundIdBytes } from '../src/helpers/globalRound';
import { setupTestMarket, TEST_BANK } from './helpers';

const PLAYER = Address.fromString('0x00000000000000000000000000000000000000b1');

function createActiveSideBet(idByte: i32, startGlobalRound: i32, windowSpins: i32): SideBet {
  setupTestMarket();
  const bet = new SideBet(Bytes.fromI32(idByte));
  bet.configId = BigInt.fromI32(1);
  bet.player = changetype<Bytes>(PLAYER);
  bet.market = "1"; // Market id from setupTestMarket (marketId 1, string ID)
  bet.bank = changetype<Bytes>(TEST_BANK);
  bet.betType = 'COLOR_COUNT';
  bet.color = 'RED';
  bet.targetNumber = 0;
  bet.targetCount = 2;
  bet.redRatioBps = 0;
  bet.startGlobalRound = BigInt.fromI32(startGlobalRound);
  bet.windowSpins = windowSpins;
  bet.spinsResolved = 0;
  bet.multiplierBps = 20_000;
  bet.stake = BigInt.fromI32(1_000_000);
  bet.potentialPayout = BigInt.fromI32(2_000_000);
  bet.actualPayout = BigInt.fromI32(0);
  bet.status = 'ACTIVE';
  bet.placedAt = BigInt.fromI32(1_000_000);
  bet.spinsObserved = [];
  bet.save();
  return bet;
}

describe('SideBet multi-spin watchlist', () => {
  beforeEach(() => {
    clearStore();
  });

  test('registerSideBetForRoundWatch enrolls the bet for every round of its window', () => {
    const bet = createActiveSideBet(1, 10, 3);
    registerSideBetForRoundWatch(bet.id, bet.startGlobalRound, bet.windowSpins);

    assert.entityCount('SideBetRoundPending', 3);
    for (let round = 10; round <= 12; round++) {
      assert.fieldEquals(
        'SideBetRoundPending',
        globalRoundIdBytes(BigInt.fromI32(round)).toHexString(),
        'sideBetIds',
        `[${bet.id.toHexString()}]`
      );
    }
  });

  test('two bets sharing a round accumulate in the same watchlist entry', () => {
    const first = createActiveSideBet(1, 10, 2);
    const second = createActiveSideBet(2, 11, 2);
    registerSideBetForRoundWatch(first.id, first.startGlobalRound, first.windowSpins);
    registerSideBetForRoundWatch(second.id, second.startGlobalRound, second.windowSpins);

    // Rounds 10, 11, 12 — round 11 is shared by both bets.
    assert.entityCount('SideBetRoundPending', 3);
    assert.fieldEquals(
      'SideBetRoundPending',
      globalRoundIdBytes(BigInt.fromI32(11)).toHexString(),
      'sideBetIds',
      `[${first.id.toHexString()}, ${second.id.toHexString()}]`
    );
  });

  test('spins accumulate across several VRF rounds until the window is full', () => {
    const bet = createActiveSideBet(1, 10, 3);
    registerSideBetForRoundWatch(bet.id, bet.startGlobalRound, bet.windowSpins);

    observeSideBetSpinsForRound(BigInt.fromI32(10), BigInt.fromI32(7));
    observeSideBetSpinsForRound(BigInt.fromI32(11), BigInt.fromI32(0));
    observeSideBetSpinsForRound(BigInt.fromI32(12), BigInt.fromI32(32));

    const id = bet.id.toHexString();
    assert.fieldEquals('SideBet', id, 'spinsObserved', '[7, 0, 32]');
    assert.fieldEquals('SideBet', id, 'spinsResolved', '3');
  });

  test('a round outside the bet window does not touch the bet', () => {
    const bet = createActiveSideBet(1, 10, 2);
    registerSideBetForRoundWatch(bet.id, bet.startGlobalRound, bet.windowSpins);

    observeSideBetSpinsForRound(BigInt.fromI32(9), BigInt.fromI32(5));
    observeSideBetSpinsForRound(BigInt.fromI32(12), BigInt.fromI32(6));

    assert.fieldEquals('SideBet', bet.id.toHexString(), 'spinsResolved', '0');
  });

  test('a settled bet in the watchlist is skipped by later observations', () => {
    const bet = createActiveSideBet(1, 10, 3);
    registerSideBetForRoundWatch(bet.id, bet.startGlobalRound, bet.windowSpins);

    observeSideBetSpinsForRound(BigInt.fromI32(10), BigInt.fromI32(7));

    // Reload from the store (the local copy is stale after the observation).
    const settled = SideBet.load(bet.id);
    assert.assertNotNull(settled);
    settled!.status = 'WON';
    settled!.save();
    observeSideBetSpinsForRound(BigInt.fromI32(11), BigInt.fromI32(3));

    const id = bet.id.toHexString();
    assert.fieldEquals('SideBet', id, 'spinsObserved', '[7]');
    assert.fieldEquals('SideBet', id, 'spinsResolved', '1');
  });
});
