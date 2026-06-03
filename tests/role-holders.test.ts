import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import {
  RoleAdminChanged as VaultRoleAdminChanged,
  RoleGranted as VaultRoleGranted,
  RoleRevoked as VaultRoleRevoked,
} from '../generated/templates/BankVault/BankVault4626';
import {
  RoleAdminChanged as EngineRoleAdminChanged,
  RoleGranted as EngineRoleGranted,
} from '../generated/RouletteEngine/Game';
import { RoleGranted as SideBetRoleGranted } from '../generated/SideBet/SideBet';
import { RoleGranted as FunderRoleGranted } from '../generated/BRBJackpotFunder/BRBJackpotFunder';
import {
  handleRoleAdminChanged as handleVaultRoleAdminChanged,
  handleRoleGranted as handleVaultRoleGranted,
  handleRoleRevoked as handleVaultRoleRevoked,
} from '../src/mappings/bank-vault';
import {
  handleRoleGranted as handleEngineRoleGranted,
  handleRoleAdminChanged as handleEngineRoleAdminChanged,
} from '../src/mappings/roulette';
import { handleRoleGranted as handleSideBetRoleGranted } from '../src/mappings/side-bet';
import { handleRoleGranted as handleFunderRoleGranted } from '../src/mappings/jackpot-funder';
import { contractRoleId, roleHolderId } from '../src/helpers/access-control';
import { DEFAULT_USER, setupTestMarket, TEST_BANK, TEST_ENGINE } from './helpers';

const TEST_SIDE_BET = Address.fromString('0x1ccc659dcee5af5c42263d1c9a9768d13025a020');
const TEST_JACKPOT_FUNDER = Address.fromString('0x2a36366e71cc52e21607f71b0a9f14216bfb2510');

const ADMIN_ROLE = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000000000000000000000000000'
);
const PAUSER_ROLE = Bytes.fromHexString(
  '0x65d7a336e8d68777a5b0a42ebe1b7946d864f9e1a61e75f0f04a153cdf089d06'
);
const GRANTOR = '0xdddd000000000000000000000000000000000003';

function buildRoleGranted(
  contract: Address,
  account: string,
  timestamp: i32
): VaultRoleGranted {
  const event = changetype<VaultRoleGranted>(newMockEvent());
  event.address = contract;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(PAUSER_ROLE)));
  event.parameters.push(
    new ethereum.EventParam('account', ethereum.Value.fromAddress(Address.fromString(account)))
  );
  event.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(GRANTOR)))
  );
  event.block.timestamp = BigInt.fromI32(timestamp);
  return event;
}

describe('AccessControl role holders', () => {
  beforeEach(() => {
    clearStore();
  });

  test('BankVault RoleGranted creates ContractRole and active RoleHolder', () => {
    setupTestMarket();
    handleVaultRoleGranted(buildRoleGranted(TEST_BANK, DEFAULT_USER, 1_000_000));

    assert.entityCount('ContractRole', 1);
    assert.entityCount('RoleHolder', 1);
    assert.fieldEquals('ContractRole', contractRoleId(TEST_BANK, PAUSER_ROLE), 'contractName', 'BankVault');
    assert.fieldEquals(
      'RoleHolder',
      roleHolderId(TEST_BANK, PAUSER_ROLE, Address.fromString(DEFAULT_USER)),
      'active',
      'true'
    );
  });

  test('BankVault RoleRevoked deactivates holder; re-grant reactivates', () => {
    setupTestMarket();
    const account = Address.fromString(DEFAULT_USER);
    const grantor = Address.fromString(GRANTOR);

    handleVaultRoleGranted(buildRoleGranted(TEST_BANK, DEFAULT_USER, 1_000_000));

    const revoked = changetype<VaultRoleRevoked>(newMockEvent());
    revoked.address = TEST_BANK;
    revoked.parameters = new Array<ethereum.EventParam>();
    revoked.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(PAUSER_ROLE)));
    revoked.parameters.push(new ethereum.EventParam('account', ethereum.Value.fromAddress(account)));
    revoked.parameters.push(new ethereum.EventParam('sender', ethereum.Value.fromAddress(grantor)));
    revoked.block.timestamp = BigInt.fromI32(1_000_100);
    handleVaultRoleRevoked(revoked);

    const holderId = roleHolderId(TEST_BANK, PAUSER_ROLE, account);
    assert.fieldEquals('RoleHolder', holderId, 'active', 'false');

    handleVaultRoleGranted(buildRoleGranted(TEST_BANK, DEFAULT_USER, 1_000_200));
    assert.fieldEquals('RoleHolder', holderId, 'active', 'true');
    assert.entityCount('RoleHolder', 1);
  });

  test('BankVault RoleAdminChanged updates ContractRole.adminRole', () => {
    setupTestMarket();
    const event = changetype<VaultRoleAdminChanged>(newMockEvent());
    event.address = TEST_BANK;
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(PAUSER_ROLE)));
    event.parameters.push(new ethereum.EventParam('previousAdminRole', ethereum.Value.fromFixedBytes(ADMIN_ROLE)));
    event.parameters.push(new ethereum.EventParam('newAdminRole', ethereum.Value.fromFixedBytes(ADMIN_ROLE)));

    handleVaultRoleAdminChanged(event);

    assert.fieldEquals(
      'ContractRole',
      contractRoleId(TEST_BANK, PAUSER_ROLE),
      'adminRole',
      ADMIN_ROLE.toHexString()
    );
  });

  test('RouletteEngine roles use same ContractRole / RoleHolder entities', () => {
    const event = changetype<EngineRoleGranted>(newMockEvent());
    event.address = TEST_ENGINE;
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(PAUSER_ROLE)));
    event.parameters.push(
      new ethereum.EventParam('account', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    event.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(GRANTOR)))
    );
    event.block.timestamp = BigInt.fromI32(1_000_000);

    handleEngineRoleGranted(event);

    assert.fieldEquals(
      'ContractRole',
      contractRoleId(TEST_ENGINE, PAUSER_ROLE),
      'contractName',
      'RouletteEngine'
    );
    assert.entityCount('RoleHolder', 1);
  });

  test('SideBet and BRBJackpotFunder roles are indexed with distinct contract keys', () => {
    const sideBetEv = changetype<SideBetRoleGranted>(newMockEvent());
    sideBetEv.address = TEST_SIDE_BET;
    sideBetEv.parameters = new Array<ethereum.EventParam>();
    sideBetEv.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(PAUSER_ROLE)));
    sideBetEv.parameters.push(
      new ethereum.EventParam('account', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    sideBetEv.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(GRANTOR)))
    );
    sideBetEv.block.timestamp = BigInt.fromI32(1_000_000);
    handleSideBetRoleGranted(sideBetEv);

    const funderEv = changetype<FunderRoleGranted>(newMockEvent());
    funderEv.address = TEST_JACKPOT_FUNDER;
    funderEv.parameters = sideBetEv.parameters;
    funderEv.block.timestamp = BigInt.fromI32(1_000_050);
    handleFunderRoleGranted(funderEv);

    assert.entityCount('ContractRole', 2);
    assert.fieldEquals(
      'ContractRole',
      contractRoleId(TEST_SIDE_BET, PAUSER_ROLE),
      'contractName',
      'SideBet'
    );
    assert.fieldEquals(
      'ContractRole',
      contractRoleId(TEST_JACKPOT_FUNDER, PAUSER_ROLE),
      'contractName',
      'BRBJackpotFunder'
    );
  });

  test('protocol-wide query: active holders filtered by contractName', () => {
    const engineGrant = changetype<EngineRoleGranted>(buildRoleGranted(TEST_ENGINE, DEFAULT_USER, 1_000_000));
    handleEngineRoleGranted(engineGrant);

    const adminChange = changetype<EngineRoleAdminChanged>(newMockEvent());
    adminChange.address = TEST_ENGINE;
    adminChange.parameters = new Array<ethereum.EventParam>();
    adminChange.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(ADMIN_ROLE)));
    adminChange.parameters.push(new ethereum.EventParam('previousAdminRole', ethereum.Value.fromFixedBytes(ADMIN_ROLE)));
    adminChange.parameters.push(new ethereum.EventParam('newAdminRole', ethereum.Value.fromFixedBytes(ADMIN_ROLE)));
    handleEngineRoleAdminChanged(adminChange);

    assert.fieldEquals(
      'ContractRole',
      contractRoleId(TEST_ENGINE, ADMIN_ROLE),
      'contractName',
      'RouletteEngine'
    );
  });
});
