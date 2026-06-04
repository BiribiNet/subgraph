import { Address } from "@graphprotocol/graph-ts"

/** Must match deployments/arbitrum-sepolia.json addresses.jackpotTreasury (sync-pipeline). */
export const JACKPOT_TREASURY_ADDRESS = Address.fromString(
  "0x4416181c11ee20481c466ed95fc8e997adbf5774"
)
/** Must match deployments/arbitrum-sepolia.json addresses.brb (sync-pipeline). */
export const BRB_TOKEN_ADDRESS = Address.fromString(
  "0xa8dedb784804f07e1748582ca309ef74acd8c040"
)
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
// Constants for bet types (same as in roulette.ts)
export const BET_STRAIGHT = 1
export const BET_SPLIT = 2
export const BET_STREET = 3
export const BET_CORNER = 4
export const BET_LINE = 5
export const BET_COLUMN = 6
export const BET_DOZEN = 7
export const BET_RED = 8
export const BET_BLACK = 9
export const BET_ODD = 10
export const BET_EVEN = 11
export const BET_LOW = 12
export const BET_HIGH = 13
export const BET_TRIO_012 = 14
export const BET_TRIO_023 = 15

// Constants for round status
export const ROUND_STATUS_BETTING = "BETTING"
export const ROUND_STATUS_NO_MORE_BETS = "NO_MORE_BETS"
export const ROUND_STATUS_VRF = "VRF"
export const ROUND_STATUS_PAYOUT = "PAYOUT"
export const ROUND_STATUS_CLEAN = "CLEAN"

// Constants for bet types
export const BET_TYPE_STRAIGHT = "STRAIGHT"
export const BET_TYPE_SPLIT = "SPLIT"
export const BET_TYPE_STREET = "STREET"
export const BET_TYPE_CORNER = "CORNER"
export const BET_TYPE_LINE = "LINE"
export const BET_TYPE_COLUMN = "COLUMN"
export const BET_TYPE_DOZEN = "DOZEN"
export const BET_TYPE_RED = "RED"
export const BET_TYPE_BLACK = "BLACK"
export const BET_TYPE_ODD = "ODD"
export const BET_TYPE_EVEN = "EVEN"
export const BET_TYPE_LOW = "LOW"
export const BET_TYPE_HIGH = "HIGH"
export const BET_TYPE_TRIO_012 = "TRIO_012"
export const BET_TYPE_TRIO_023 = "TRIO_023"
