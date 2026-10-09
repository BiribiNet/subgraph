import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { PlayerProtection } from "../../generated/schema"
import { PlayerLimitsChanged, PlayerExcluded, PlayerStakeRecorded } from "../../generated/templates/BankVault/BankVault4626"

function observation(event: ethereum.Event, player: Bytes): PlayerProtection {
  const id = event.address.concat(player)
  let state = PlayerProtection.load(id)
  if (state == null) {
    state = new PlayerProtection(id)
    state.bank = event.address
    state.player = player
    state.dailyLimit = BigInt.zero()
    state.sessionSeconds = BigInt.zero()
    state.pendingDailyLimit = BigInt.zero()
    state.pendingSessionSeconds = BigInt.zero()
    state.changesAt = BigInt.zero()
    state.excludedUntil = BigInt.zero()
    state.spent = BigInt.zero()
    state.spentDay = BigInt.zero()
    state.sessionStartedAt = BigInt.zero()
  }
  state.blockNumber = event.block.number
  state.timestamp = event.block.timestamp
  state.transactionHash = event.transaction.hash
  return state
}

export function handlePlayerLimitsChanged(event: PlayerLimitsChanged): void {
  const state = observation(event, event.params.player)
  state.dailyLimit = event.params.dailyLimit
  state.sessionSeconds = event.params.sessionSeconds
  state.pendingDailyLimit = event.params.pendingDailyLimit
  state.pendingSessionSeconds = event.params.pendingSessionSeconds
  state.changesAt = event.params.changesAt
  state.save()
}

export function handlePlayerExcluded(event: PlayerExcluded): void {
  const state = observation(event, event.params.player)
  state.excludedUntil = event.params.until
  state.save()
}

export function handlePlayerStakeRecorded(event: PlayerStakeRecorded): void {
  const state = observation(event, event.params.player)
  state.spent = event.params.spent
  state.spentDay = event.params.spentDay
  state.sessionStartedAt = event.params.sessionStartedAt
  state.save()
}
