import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  ForwarderAuthorityUpdated,
  LaneCursorAdvanced,
  MaxPayoutsPerCallUpdated,
  RoleAdminChanged,
  RoleGranted,
  RoleRevoked,
  ScanLimitUpdated,
  SideBetCursorAdvanced,
} from "../../generated/UpkeepScheduler/UpkeepScheduler"
import { SchedulerLaneCursor, SchedulerState } from "../../generated/schema"
import {
  ROLE_CONTRACT_UPKEEP_SCHEDULER,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { ZERO } from "../helpers/number"

function getOrCreateSchedulerState(scheduler: Address, event: ethereum.Event): SchedulerState {
  const id = changetype<Bytes>(scheduler)
  let state = SchedulerState.load(id)
  if (state == null) {
    state = new SchedulerState(id)
  }
  state.updatedAt = event.block.timestamp
  return state
}

function getOrCreateLaneCursor(lane: BigInt, event: ethereum.Event): SchedulerLaneCursor {
  const id = bigintToBytes(lane)
  let cursor = SchedulerLaneCursor.load(id)
  if (cursor == null) {
    cursor = new SchedulerLaneCursor(id)
    cursor.lane = lane
    cursor.payoutCursor = ZERO
    cursor.sideBetCursorBetId = ZERO
  }
  cursor.updatedAt = event.block.timestamp
  return cursor
}

export function handleScanLimitUpdated(event: ScanLimitUpdated): void {
  const state = getOrCreateSchedulerState(event.address, event)
  state.scanLimit = event.params.newScanLimit
  state.save()
}

export function handleMaxPayoutsPerCallUpdated(event: MaxPayoutsPerCallUpdated): void {
  const state = getOrCreateSchedulerState(event.address, event)
  state.maxPayoutsPerCall = event.params.newMaxPayoutsPerCall
  state.save()
}

export function handleForwarderAuthorityUpdated(event: ForwarderAuthorityUpdated): void {
  const state = getOrCreateSchedulerState(event.address, event)
  state.forwarderAuthority = changetype<Bytes>(event.params.authority)
  state.save()
}

export function handleLaneCursorAdvanced(event: LaneCursorAdvanced): void {
  const cursor = getOrCreateLaneCursor(event.params.lane, event)
  cursor.payoutCursor = event.params.newCursor
  cursor.save()
}

export function handleSideBetCursorAdvanced(event: SideBetCursorAdvanced): void {
  const cursor = getOrCreateLaneCursor(event.params.lane, event)
  cursor.sideBetCursorBetId = event.params.newCursor
  cursor.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_UPKEEP_SCHEDULER,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleRevoked(event: RoleRevoked): void {
  revokeRoleHolder(
    event.address,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleAdminChanged(event: RoleAdminChanged): void {
  updateRoleAdmin(
    event.address,
    ROLE_CONTRACT_UPKEEP_SCHEDULER,
    event.params.role,
    event.params.newAdminRole
  )
}
