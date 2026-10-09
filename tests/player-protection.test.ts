import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, newMockEvent, test } from 'matchstick-as';
import { PlayerLimitsChanged, PlayerExcluded, PlayerStakeRecorded } from '../generated/templates/BankVault/BankVault4626';
import { handlePlayerLimitsChanged, handlePlayerExcluded, handlePlayerStakeRecorded } from '../src/helpers/player-protection';
import { DEFAULT_USER, TEST_BANK, TEST_BANK_2, CORNER_BET_DATA, emitBetRecorded } from './helpers';

const player = Address.fromString(DEFAULT_USER);
const id = TEST_BANK.concat(player).toHexString();
function unsigned(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)));
}
beforeEach(() => clearStore());

test('protection observations preserve usage, exclusion and wallet-vault isolation', () => {
  const excluded = changetype<PlayerExcluded>(newMockEvent());
  excluded.address = TEST_BANK;
  excluded.parameters = [new ethereum.EventParam('player', ethereum.Value.fromAddress(player)), unsigned('until', 200000)];
  handlePlayerExcluded(excluded);
  const stake = changetype<PlayerStakeRecorded>(newMockEvent());
  stake.address = TEST_BANK;
  stake.parameters = [new ethereum.EventParam('player', ethereum.Value.fromAddress(player)), unsigned('spent', 80), unsigned('spentDay', 1), unsigned('sessionStartedAt', 90000)];
  handlePlayerStakeRecorded(stake);
  const changed = changetype<PlayerLimitsChanged>(newMockEvent());
  changed.address = TEST_BANK;
  changed.parameters = [new ethereum.EventParam('player', ethereum.Value.fromAddress(player)), unsigned('dailyLimit', 100), unsigned('sessionSeconds', 60), unsigned('pendingDailyLimit', 200), unsigned('pendingSessionSeconds', 120), unsigned('changesAt', 150000)];
  handlePlayerLimitsChanged(changed);
  assert.fieldEquals('PlayerProtection', id, 'excludedUntil', '200000');
  assert.fieldEquals('PlayerProtection', id, 'spent', '80');
  assert.fieldEquals('PlayerProtection', id, 'dailyLimit', '100');
  assert.fieldEquals('PlayerProtection', id, 'changesAt', '150000');
  // No synthetic clock activation: last observed state remains explicitly indexed.
  changed.address = TEST_BANK_2;
  handlePlayerLimitsChanged(changed);
  assert.entityCount('PlayerProtection', 2);
  assert.fieldEquals('PlayerProtection', TEST_BANK_2.concat(player).toHexString(), 'spent', '0');
  assert.fieldEquals('PlayerProtection', TEST_BANK_2.concat(player).toHexString(), 'excludedUntil', '0');
});

test('two placements in the same transaction remain two receipts for one ticket', () => {
  emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1, 1, 1000000, 1);
  emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1, 1, 1000000, 2);
  assert.entityCount('RoulettePlacement', 2);
  assert.entityCount('RouletteBet', 1);
});
