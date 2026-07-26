import { Bytes } from "@graphprotocol/graph-ts"
import {
  ExecutorApprovalUpdated,
  RoleAdminChanged,
  RoleGranted,
  RoleRevoked,
} from "../../generated/CreExecutionAuthority/CreExecutionAuthority"
import { CreExecutorApproval } from "../../generated/schema"
import {
  ROLE_CONTRACT_CRE_AUTHORITY,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"

export function handleExecutorApprovalUpdated(event: ExecutorApprovalUpdated): void {
  const executor = changetype<Bytes>(event.params.executor)
  let approval = CreExecutorApproval.load(executor)
  if (approval == null) {
    approval = new CreExecutorApproval(executor)
    approval.executor = executor
  }
  approval.approved = event.params.approved
  approval.updatedAt = event.block.timestamp
  approval.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_CRE_AUTHORITY,
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
    ROLE_CONTRACT_CRE_AUTHORITY,
    event.params.role,
    event.params.newAdminRole
  )
}
