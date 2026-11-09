import { BigInt } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { bigintToBytes } from '../src/helpers/bigintToBytes';
import {
  DEFAULT_USER,
  TEST_BANK,
  TEST_BANK_2,
  emitDeposit,
  emitWithdrawalProcessed,
  setupSecondTestMarket,
} from './helpers';

// `VaultDeposit.bank` / `VaultWithdrawal.bank` portent l'adresse du vault émetteur :
// le frontend filtre l'historique de staking par `bank` (STAKING_LEDGER_QUERY).
// Ils n'étaient jamais renseignés, donc ce filtre ne renvoyait aucun flux.

const HUNDRED_ASSETS = '100000000000000000000';
const FORTY_ASSETS = '40000000000000000000';
const THIRTY_ASSETS = '30000000000000000000';

/** Id déterministe d'un flux : hash de la tx mockée + logIndex de l'événement. */
function flowIdForLogIndex(logIndex: i32): string {
  return newMockEvent()
    .transaction.hash.concat(bigintToBytes(BigInt.fromI32(logIndex)))
    .toHexString();
}

describe('Flux de vault : champ bank', () => {
  beforeEach(() => {
    clearStore();
  });

  test('should set bank to the emitting vault when a deposit is indexed', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000, 0, TEST_BANK);

    assert.entityCount('VaultDeposit', 1);
    assert.fieldEquals('VaultDeposit', flowIdForLogIndex(0), 'bank', TEST_BANK.toHexString());
  });

  test('should set bank to the emitting vault when a queued withdrawal is processed', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000, 0, TEST_BANK);
    emitWithdrawalProcessed(DEFAULT_USER, 4000, DEFAULT_USER, FORTY_ASSETS, FORTY_ASSETS, 1_000_100, 5, TEST_BANK);

    assert.entityCount('VaultWithdrawal', 1);
    assert.fieldEquals('VaultWithdrawal', flowIdForLogIndex(5), 'bank', TEST_BANK.toHexString());
  });

  test('should keep each flow on its own bank when two vaults are active', () => {
    setupSecondTestMarket();

    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000, 0, TEST_BANK);
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_010, 10, TEST_BANK_2);
    emitWithdrawalProcessed(DEFAULT_USER, 4000, DEFAULT_USER, FORTY_ASSETS, FORTY_ASSETS, 1_000_100, 20, TEST_BANK);
    emitWithdrawalProcessed(DEFAULT_USER, 3000, DEFAULT_USER, THIRTY_ASSETS, THIRTY_ASSETS, 1_000_110, 30, TEST_BANK_2);

    assert.entityCount('VaultDeposit', 2);
    assert.entityCount('VaultWithdrawal', 2);
    assert.fieldEquals('VaultDeposit', flowIdForLogIndex(0), 'bank', TEST_BANK.toHexString());
    assert.fieldEquals('VaultDeposit', flowIdForLogIndex(10), 'bank', TEST_BANK_2.toHexString());
    assert.fieldEquals('VaultWithdrawal', flowIdForLogIndex(20), 'bank', TEST_BANK.toHexString());
    assert.fieldEquals('VaultWithdrawal', flowIdForLogIndex(30), 'bank', TEST_BANK_2.toHexString());
    // Le montant suit aussi son vault : aucune contamination croisée.
    assert.fieldEquals('VaultWithdrawal', flowIdForLogIndex(30), 'assets', THIRTY_ASSETS);
  });
});
