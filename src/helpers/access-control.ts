import { Address, BigInt, ByteArray, Bytes, crypto } from "@graphprotocol/graph-ts"
import { ContractRole, RoleHolder } from "../../generated/schema"

const ZERO_ROLE = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000"
)

/** Labels stored on ContractRole.contractName — one model across all protocol contracts. */
export const ROLE_CONTRACT_BANK_VAULT = "BankVault"
export const ROLE_CONTRACT_ROULETTE_ENGINE = "RouletteEngine"
export const ROLE_CONTRACT_SIDE_BET = "SideBet"
export const ROLE_CONTRACT_JACKPOT_FUNDER = "BRBJackpotFunder"
export const ROLE_CONTRACT_UPKEEP_SCHEDULER = "UpkeepScheduler"
export const ROLE_CONTRACT_CRE_AUTHORITY = "CreExecutionAuthority"

/**
 * Named roles declared across the protocol contracts. `resolveRoleName`
 * compares the raw bytes32 against keccak256 of each name (AccessControl
 * convention), so the list only needs the string — no hardcoded hashes.
 */
const KNOWN_ROLE_NAMES = [
  "ENGINE_WITHDRAWAL_ROLE",
  "ENGINE_PAYOUT_ROLE",
  "ENGINE_ROUND_ROLE",
  "ENGINE_FEE_ROLE",
  "BANK_ADMIN_ROLE",
  "SIDE_BET_CONFIG_ROLE",
  "SIDE_BET_LIMITS_ROLE",
  "SETTLEMENT_ROLE",
  "SCHEDULER_ADMIN_ROLE",
  "FUNDER_ADMIN_ROLE",
  "EXECUTOR_ADMIN_ROLE",
  "TREASURY_ADMIN_ROLE",
  "MARKET_FACTORY_ROLE",
]

/** keccak reverse lookup of the protocol's named roles; null for unknown roles. */
export function resolveRoleName(role: Bytes): string | null {
  if (role.equals(ZERO_ROLE)) {
    return "DEFAULT_ADMIN_ROLE"
  }
  for (let nameIndex = 0; nameIndex < KNOWN_ROLE_NAMES.length; nameIndex++) {
    const name = KNOWN_ROLE_NAMES[nameIndex]
    const hash = crypto.keccak256(ByteArray.fromUTF8(name))
    if (role.equals(Bytes.fromByteArray(hash))) {
      return name
    }
  }
  return null
}

export function contractRoleId(contract: Address, role: Bytes): string {
  return contract.toHexString() + "-" + role.toHexString()
}

export function roleHolderId(contract: Address, role: Bytes, account: Address): string {
  return contractRoleId(contract, role) + "-" + account.toHexString()
}

export function getOrCreateContractRole(
  contract: Address,
  contractName: string,
  role: Bytes
): ContractRole {
  const id = contractRoleId(contract, role)
  let entity = ContractRole.load(id)
  if (entity == null) {
    entity = new ContractRole(id)
    entity.contract = changetype<Bytes>(contract)
    entity.contractName = contractName
    entity.role = role
    entity.roleName = resolveRoleName(role)
    entity.adminRole = ZERO_ROLE
  }
  return entity
}

export function grantRoleHolder(
  contract: Address,
  contractName: string,
  role: Bytes,
  account: Address,
  sender: Address,
  timestamp: BigInt
): void {
  const contractRole = getOrCreateContractRole(contract, contractName, role)
  contractRole.save()

  const holder = new RoleHolder(roleHolderId(contract, role, account))
  holder.role = contractRole.id
  holder.account = changetype<Bytes>(account)
  holder.active = true
  holder.grantedAt = timestamp
  holder.grantedBy = changetype<Bytes>(sender)
  holder.revokedAt = null
  holder.revokedBy = null
  holder.save()
}

export function revokeRoleHolder(
  contract: Address,
  role: Bytes,
  account: Address,
  sender: Address,
  timestamp: BigInt
): void {
  const holder = RoleHolder.load(roleHolderId(contract, role, account))
  if (holder == null) {
    return
  }
  holder.active = false
  holder.revokedAt = timestamp
  holder.revokedBy = changetype<Bytes>(sender)
  holder.save()
}

export function updateRoleAdmin(
  contract: Address,
  contractName: string,
  role: Bytes,
  adminRole: Bytes
): void {
  const contractRole = getOrCreateContractRole(contract, contractName, role)
  contractRole.adminRole = adminRole
  contractRole.save()
}
