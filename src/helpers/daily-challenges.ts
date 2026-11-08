import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { DailyChallengeCompletion, RouletteMaskLeg, UserDailyChallenges } from "../../generated/schema"
import { recomputeAndSaveUserPoints } from "./brb-points"
import { FREE_SELECTION_PRESET_ID } from "./special-bet-presets"
import { getOrCreateUser } from "./user"
import { ZERO } from "./number"

// Défis du jour (décision du propriétaire du 08/11/2026). Définition partagée avec le frontend :
// docs/daily-challenges.json (copie identique dans frontend lib/daily-challenges/definition.json),
// vérifiée par scripts/check-daily-challenges.mjs. Toute modification du catalogue ou de la rotation
// change les points de vote : elle exige une ré-indexation complète, sans greffe.
//
// - 3 défis par jour UTC, 10 points chacun : au plus 30 points par jour et par joueur.
// - Rotation : défi(jour, slot) = CATALOGUE[(jour * 3 + slot) mod taille], jour = timestamp / 86400
//   du PLACEMENT de la jambe (un pari placé à 23 h 59 et réglé après minuit compte pour la veille).
// - Seules comptent les jambes réglées (VRFResult) dont la mise atteint Market.minBet.
// - Un défi n'est validé qu'une fois par jour et par joueur : DailyChallengeCompletion, id
//   déterministe user + jour + défi, est la clé de déduplication et précède l'attribution des points.

export const SECONDS_PER_DAY: i32 = 86400
export const CHALLENGES_PER_DAY: i32 = 3
export const POINTS_PER_CHALLENGE = BigInt.fromI32(10)

export const CHALLENGE_IDS: i32[] = [1, 2, 3, 4, 5, 6, 7, 8]
export const CHALLENGE_KINDS: string[] = [
  "WIN_DISTINCT_PRESETS",
  "WIN_PRESET_FAMILY",
  "WIN_SMALL_FREE_SELECTION",
  "PLAY_DISTINCT_ROUNDS",
  "WIN_PRESET_FAMILY",
  "WIN_PRESET_FAMILY",
  "PLAY_LEGS",
  "WIN_PRESET_FAMILY",
]
export const CHALLENGE_FAMILIES: string[] = ["", "PREVIOUS_DRAW", "", "", "ENDINGS", "THEMATIC", "", "NEIGHBOURS"]
export const CHALLENGE_TARGETS: i32[] = [3, 1, 1, 3, 1, 1, 5, 1]
/** Taille maximale d'une Sélection libre gagnante pour le défi WIN_SMALL_FREE_SELECTION. */
export const SMALL_FREE_SELECTION_MAX_SIZE: i32 = 5
/** Plus grande cible d'un défi PLAY_DISTINCT_ROUNDS : inutile de mémoriser plus de tours. */
const MAX_TRACKED_ROUNDS: i32 = 3

const THEMATIC_MIN: i32 = 1
const THEMATIC_MAX: i32 = 12
const ENDINGS_MIN: i32 = 20
const ENDINGS_MAX: i32 = 29
const PREVIOUS_DRAW_MIN: i32 = 40
const PREVIOUS_DRAW_MAX: i32 = 50
export const NEIGHBOUR_PRESET_IDS: i32[] = [42, 48]

const FAMILY_NAMES: string[] = ["THEMATIC", "ENDINGS", "PREVIOUS_DRAW", "NEIGHBOURS"]

export function isPresetInFamily(presetId: i32, family: string): boolean {
  if (family == "THEMATIC") return presetId >= THEMATIC_MIN && presetId <= THEMATIC_MAX
  if (family == "ENDINGS") return presetId >= ENDINGS_MIN && presetId <= ENDINGS_MAX
  if (family == "PREVIOUS_DRAW") return presetId >= PREVIOUS_DRAW_MIN && presetId <= PREVIOUS_DRAW_MAX
  if (family == "NEIGHBOURS") return NEIGHBOUR_PRESET_IDS.includes(presetId)
  return false
}

/** Index dans le catalogue des défis du jour, dans l'ordre des slots. */
export function challengeIndexesForDay(day: i32): i32[] {
  const indexes = new Array<i32>()
  for (let slot = 0; slot < CHALLENGES_PER_DAY; slot++) {
    indexes.push((day * CHALLENGES_PER_DAY + slot) % CHALLENGE_IDS.length)
  }
  return indexes
}

export function dailyChallengesId(user: Bytes, day: i32): Bytes {
  return user.concatI32(day)
}

function completionId(user: Bytes, day: i32, challengeId: i32): Bytes {
  return user.concatI32(day).concatI32(challengeId)
}

export function getOrCreateDailyChallenges(user: Bytes, day: i32): UserDailyChallenges {
  const id = dailyChallengesId(user, day)
  let state = UserDailyChallenges.load(id)
  if (state != null) return state
  state = new UserDailyChallenges(id)
  state.user = user
  state.day = day
  const indexes = challengeIndexesForDay(day)
  const ids = new Array<i32>()
  const progress = new Array<i32>()
  const completed = new Array<boolean>()
  for (let slot = 0; slot < indexes.length; slot++) {
    ids.push(CHALLENGE_IDS[indexes[slot]])
    progress.push(0)
    completed.push(false)
  }
  state.challengeIds = ids
  state.progress = progress
  state.completed = completed
  state.points = ZERO
  state.wonPresetIds = new Array<i32>()
  state.playedRounds = new Array<BigInt>()
  state.legCount = 0
  state.wonFamilies = new Array<string>()
  state.smallFreeSelectionWins = 0
  state.updatedAt = ZERO
  return state
}

/** Intègre une jambe réglée et éligible dans l'état du jour (ensembles distincts, compteurs). */
export function applyLegToDay(
  state: UserDailyChallenges,
  roundNumber: BigInt,
  presetId: i32,
  size: i32,
  won: boolean
): void {
  state.legCount = state.legCount + 1
  const rounds = state.playedRounds
  let seen = false
  for (let index = 0; index < rounds.length; index++) {
    if (rounds[index].equals(roundNumber)) seen = true
  }
  if (!seen && rounds.length < MAX_TRACKED_ROUNDS) {
    rounds.push(roundNumber)
    state.playedRounds = rounds
  }
  if (!won) return
  const presets = state.wonPresetIds
  if (!presets.includes(presetId)) {
    presets.push(presetId)
    state.wonPresetIds = presets
  }
  const families = state.wonFamilies
  for (let index = 0; index < FAMILY_NAMES.length; index++) {
    const family = FAMILY_NAMES[index]
    if (isPresetInFamily(presetId, family) && !families.includes(family)) families.push(family)
  }
  state.wonFamilies = families
  if (presetId == FREE_SELECTION_PRESET_ID && size <= SMALL_FREE_SELECTION_MAX_SIZE) {
    state.smallFreeSelectionWins = state.smallFreeSelectionWins + 1
  }
}

function rawProgress(challengeIndex: i32, state: UserDailyChallenges): i32 {
  const kind = CHALLENGE_KINDS[challengeIndex]
  if (kind == "WIN_DISTINCT_PRESETS") return state.wonPresetIds.length
  if (kind == "WIN_PRESET_FAMILY") return state.wonFamilies.includes(CHALLENGE_FAMILIES[challengeIndex]) ? 1 : 0
  if (kind == "WIN_SMALL_FREE_SELECTION") return state.smallFreeSelectionWins
  if (kind == "PLAY_DISTINCT_ROUNDS") return state.playedRounds.length
  if (kind == "PLAY_LEGS") return state.legCount
  return 0
}

/** Progression d'un défi du catalogue, plafonnée à sa cible. */
export function challengeProgress(challengeIndex: i32, state: UserDailyChallenges): i32 {
  const progress = rawProgress(challengeIndex, state)
  const target = CHALLENGE_TARGETS[challengeIndex]
  return progress < target ? progress : target
}

/**
 * Applique une jambe de pari spécial qui vient d'être réglée aux défis de son jour de placement et
 * attribue les points des défis qui viennent d'être validés. Appelée une seule fois par jambe.
 */
export function recordChallengeLeg(leg: RouletteMaskLeg, roundNumber: BigInt, timestamp: BigInt, blockNumber: BigInt): void {
  if (!leg.meetsMinBet) return
  const day = leg.timestamp.div(BigInt.fromI32(SECONDS_PER_DAY)).toI32()
  const state = getOrCreateDailyChallenges(leg.user, day)
  applyLegToDay(state, roundNumber, leg.canonicalPresetId, leg.maskSize, leg.won)

  const indexes = challengeIndexesForDay(day)
  const progress = state.progress
  const completed = state.completed
  let earned = ZERO
  let validated = 0
  for (let slot = 0; slot < indexes.length; slot++) {
    progress[slot] = challengeProgress(indexes[slot], state)
    if (completed[slot] || progress[slot] < CHALLENGE_TARGETS[indexes[slot]]) continue
    completed[slot] = true
    const challengeId = CHALLENGE_IDS[indexes[slot]]
    const id = completionId(leg.user, day, challengeId)
    if (DailyChallengeCompletion.load(id) != null) continue
    const completion = new DailyChallengeCompletion(id)
    completion.user = leg.user
    completion.day = day
    completion.challengeId = challengeId
    completion.points = POINTS_PER_CHALLENGE
    completion.leg = leg.id
    completion.timestamp = timestamp
    completion.blockNumber = blockNumber
    completion.save()
    earned = earned.plus(POINTS_PER_CHALLENGE)
    validated++
  }
  state.progress = progress
  state.completed = completed
  state.points = state.points.plus(earned)
  state.updatedAt = timestamp
  state.save()

  if (validated == 0) return
  const user = getOrCreateUser(leg.user)
  user.challengePoints = user.challengePoints.plus(earned)
  user.challengeCount = user.challengeCount.plus(BigInt.fromI32(validated))
  recomputeAndSaveUserPoints(user, timestamp)
}

