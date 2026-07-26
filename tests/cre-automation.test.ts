import { Address, BigInt, ByteArray, Bytes, crypto, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import {
  CallAllowedSet,
  CallExecuted,
  CallFailed,
} from '../generated/AutomationReceiver/AutomationReceiver';
import {
  ForwarderAuthorityUpdated,
  LaneCursorAdvanced,
  MaxPayoutsPerCallUpdated,
  RoleGranted,
  ScanLimitUpdated,
  SideBetCursorAdvanced,
} from '../generated/UpkeepScheduler/UpkeepScheduler';
import { ExecutorApprovalUpdated } from '../generated/CreExecutionAuthority/CreExecutionAuthority';
import {
  handleCallAllowedSet,
  handleCallExecuted,
  handleCallFailed,
} from '../src/mappings/automation-receiver';
import {
  handleForwarderAuthorityUpdated,
  handleLaneCursorAdvanced,
  handleMaxPayoutsPerCallUpdated,
  handleRoleGranted,
  handleScanLimitUpdated,
  handleSideBetCursorAdvanced,
} from '../src/mappings/upkeep-scheduler';
import { handleExecutorApprovalUpdated } from '../src/mappings/cre-authority';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import { contractRoleId } from '../src/helpers/access-control';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

const RECEIVER = Address.fromString('0xfda0edcbcf2c6360279cf10ec079d56d43795a86');
const SCHEDULER = Address.fromString('0xad1f181ad88aee13a6643104941ecea2b963c2d7');
const AUTHORITY = Address.fromString('0xb24093fd7cbca76c0a4098cdff5f27d0734a2a68');
const PERFORM_UPKEEP_SELECTOR = Bytes.fromHexString('0x4585e33b');

function baseEvent<T extends ethereum.Event>(event: T, emitter: Address): T {
  event.address = emitter;
  event.parameters = new Array<ethereum.EventParam>();
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

function callEventParams(event: ethereum.Event, reason: Bytes): void {
  event.parameters.push(
    new ethereum.EventParam('target', ethereum.Value.fromAddress(SCHEDULER))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'selector',
      ethereum.Value.fromFixedBytes(PERFORM_UPKEEP_SELECTOR)
    )
  );
  event.parameters.push(new ethereum.EventParam('returnData', ethereum.Value.fromBytes(reason)));
}

function callId(event: ethereum.Event): string {
  return event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
}

describe('CRE automation', () => {
  beforeEach(() => {
    clearStore();
  });

  test('CallExecuted creates a successful AutomationCall', () => {
    const event = baseEvent(changetype<CallExecuted>(newMockEvent()), RECEIVER);
    callEventParams(event, Bytes.empty());
    handleCallExecuted(event);

    assert.entityCount('AutomationCall', 1);
    const id = callId(event);
    assert.fieldEquals('AutomationCall', id, 'success', 'true');
    assert.fieldEquals('AutomationCall', id, 'target', SCHEDULER.toHexString());
    assert.fieldEquals('AutomationCall', id, 'selector', PERFORM_UPKEEP_SELECTOR.toHexString());
  });

  test('CallFailed creates a failed AutomationCall and increments the health counters', () => {
    const globalState = getOrCreateGlobalState();
    globalState.save();

    const event = baseEvent(changetype<CallFailed>(newMockEvent()), RECEIVER);
    callEventParams(event, Bytes.fromHexString('0xdeadbeef'));
    handleCallFailed(event);

    const id = callId(event);
    assert.fieldEquals('AutomationCall', id, 'success', 'false');
    assert.fieldEquals('AutomationCall', id, 'reason', '0xdeadbeef');
    assert.fieldEquals(
      'GlobalState',
      '0x0000000000000000000000000000000000000001',
      'failedAutomationCalls',
      '1'
    );
    // The failure is attributed to the round that was current (round 1 seeded
    // by getOrCreateGlobalState).
    assert.fieldEquals(
      'GlobalRound',
      bigintToBytes(BigInt.fromI32(1)).toHexString(),
      'failedAutomationCalls',
      '1'
    );
  });

  test('CallAllowedSet upserts the (target, selector) allowance', () => {
    const event = baseEvent(changetype<CallAllowedSet>(newMockEvent()), RECEIVER);
    event.parameters.push(
      new ethereum.EventParam('target', ethereum.Value.fromAddress(SCHEDULER))
    );
    event.parameters.push(
      new ethereum.EventParam(
        'selector',
        ethereum.Value.fromFixedBytes(PERFORM_UPKEEP_SELECTOR)
      )
    );
    event.parameters.push(new ethereum.EventParam('allowed', ethereum.Value.fromBoolean(true)));
    handleCallAllowedSet(event);

    const id = changetype<Bytes>(SCHEDULER).concat(PERFORM_UPKEEP_SELECTOR).toHexString();
    assert.fieldEquals('AutomationCallAllowance', id, 'allowed', 'true');
  });

  test('Scheduler config events update the SchedulerState singleton', () => {
    const scanEvent = baseEvent(changetype<ScanLimitUpdated>(newMockEvent()), SCHEDULER);
    scanEvent.parameters.push(
      new ethereum.EventParam('newScanLimit', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(250)))
    );
    handleScanLimitUpdated(scanEvent);

    const payoutsEvent = baseEvent(changetype<MaxPayoutsPerCallUpdated>(newMockEvent()), SCHEDULER);
    payoutsEvent.parameters.push(
      new ethereum.EventParam(
        'newMaxPayoutsPerCall',
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(40))
      )
    );
    handleMaxPayoutsPerCallUpdated(payoutsEvent);

    const authorityEvent = baseEvent(
      changetype<ForwarderAuthorityUpdated>(newMockEvent()),
      SCHEDULER
    );
    authorityEvent.parameters.push(
      new ethereum.EventParam('authority', ethereum.Value.fromAddress(AUTHORITY))
    );
    handleForwarderAuthorityUpdated(authorityEvent);

    const id = SCHEDULER.toHexString();
    assert.fieldEquals('SchedulerState', id, 'scanLimit', '250');
    assert.fieldEquals('SchedulerState', id, 'maxPayoutsPerCall', '40');
    assert.fieldEquals('SchedulerState', id, 'forwarderAuthority', AUTHORITY.toHexString());
  });

  test('Lane cursor events track payout and side-bet cursors per lane', () => {
    const laneEvent = baseEvent(changetype<LaneCursorAdvanced>(newMockEvent()), SCHEDULER);
    laneEvent.parameters.push(
      new ethereum.EventParam('lane', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    laneEvent.parameters.push(
      new ethereum.EventParam('previousCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10)))
    );
    laneEvent.parameters.push(
      new ethereum.EventParam('newCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(25)))
    );
    handleLaneCursorAdvanced(laneEvent);

    const sideBetEvent = baseEvent(changetype<SideBetCursorAdvanced>(newMockEvent()), SCHEDULER);
    sideBetEvent.parameters.push(
      new ethereum.EventParam('lane', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    sideBetEvent.parameters.push(
      new ethereum.EventParam('previousCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3)))
    );
    sideBetEvent.parameters.push(
      new ethereum.EventParam('newCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7)))
    );
    handleSideBetCursorAdvanced(sideBetEvent);

    const id = bigintToBytes(BigInt.fromI32(1)).toHexString();
    assert.fieldEquals('SchedulerLaneCursor', id, 'payoutCursor', '25');
    assert.fieldEquals('SchedulerLaneCursor', id, 'sideBetCursorBetId', '7');
  });

  test('ExecutorApprovalUpdated upserts the executor approval', () => {
    const event = baseEvent(changetype<ExecutorApprovalUpdated>(newMockEvent()), AUTHORITY);
    event.parameters.push(
      new ethereum.EventParam('executor', ethereum.Value.fromAddress(RECEIVER))
    );
    event.parameters.push(new ethereum.EventParam('approved', ethereum.Value.fromBoolean(true)));
    handleExecutorApprovalUpdated(event);

    assert.fieldEquals('CreExecutorApproval', RECEIVER.toHexString(), 'approved', 'true');
  });

  test('RoleGranted resolves the human-readable role name', () => {
    const role = Bytes.fromByteArray(
      crypto.keccak256(ByteArray.fromUTF8('SCHEDULER_ADMIN_ROLE'))
    );
    const admin = Address.fromString('0x00000000000000000000000000000000000000aa');

    const event = baseEvent(changetype<RoleGranted>(newMockEvent()), SCHEDULER);
    event.parameters.push(new ethereum.EventParam('role', ethereum.Value.fromFixedBytes(role)));
    event.parameters.push(new ethereum.EventParam('account', ethereum.Value.fromAddress(admin)));
    event.parameters.push(new ethereum.EventParam('sender', ethereum.Value.fromAddress(admin)));
    handleRoleGranted(event);

    const id = contractRoleId(SCHEDULER, role);
    assert.fieldEquals('ContractRole', id, 'roleName', 'SCHEDULER_ADMIN_ROLE');
    assert.fieldEquals('ContractRole', id, 'contractName', 'UpkeepScheduler');
  });
});
