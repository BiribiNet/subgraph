import { BigInt } from "@graphprotocol/graph-ts"
import { ONE, ZERO } from "./number"

// Catalogue des paris spéciaux (presets), miroir de frontend `lib/mask-bets/presets.ts`.
// Le presetId est une donnée libre et non validée on-chain (le moteur ne le lit jamais) :
// n'importe qui peut étiqueter un masque arbitraire « nombres premiers ». Pour les stats et
// les défis du jour, on ne retient donc le presetId que si le masque EST ce preset ; sinon
// la jambe compte comme une Sélection libre (0). Les ids sont figés :
//   1–12 thématiques, 20–29 finales, 40–50 liés au tirage précédent, 0 = Sélection libre.
// Masques statiques et vecteurs : docs/daily-challenges.json (vérifié par
// scripts/check-daily-challenges.mjs). Tout se calcule sur des i32 bornés (0..36) ou des BigInt.

export const FREE_SELECTION_PRESET_ID: i32 = 0

const POCKET_COUNT: i32 = 37
const MAX_POCKET: i32 = 36
const DECIMAL_BASE: i32 = 10
const DOZEN_SIZE: i32 = 12
const NEIGHBOUR_DISTANCE: i32 = 2
/** Preset 47 : les 18 cases les plus éloignées de p sont à une distance de 10 à 18. */
const OPPOSITE_HALF_MIN_DISTANCE: i32 = 10
const MIN_WHEEL_DISTANCE: i32 = 1
const MAX_WHEEL_DISTANCE: i32 = 17

const ABOVE_PREVIOUS: i32 = 40
const BELOW_PREVIOUS: i32 = 41
const NEIGHBOURS_OF_PREVIOUS: i32 = 42
const SAME_COLOUR_AS_PREVIOUS: i32 = 43
const SAME_DOZEN_AS_PREVIOUS: i32 = 44
const SAME_ENDING_AS_PREVIOUS: i32 = 45
const ADJACENT_ENDINGS_OF_PREVIOUS: i32 = 46
const OPPOSITE_HALF_OF_PREVIOUS: i32 = 47
const WITHIN_N_OF_PREVIOUS: i32 = 48
const OPPOSITE_COLOUR_OF_PREVIOUS: i32 = 49
const OPPOSITE_PARITY_OF_PREVIOUS: i32 = 50

/** Ordre des cases sur le cylindre européen, sens horaire depuis 0. */
const EUROPEAN_WHEEL_ORDER: i32[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]
const RED_POCKETS: i32[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]

// Masques des presets statiques (décimal), dans l'ordre des ids ci-dessous.
// Doivent rester égaux à `staticPresetMasks` de docs/daily-challenges.json (en hexadécimal).
export const STATIC_PRESET_IDS: i32[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]
export const STATIC_PRESET_MASKS: string[] = [
  "2693408940", "136373608456", "68753097234", "17181974830", "8594130944", "68853957120",
  "73300775184", "34630287488", "91268403200", "45634201600", "178782890", "357565780",
  "1074791424", "2149582850", "4299165700", "8598331400", "17196662800", "34393325600",
  "68786651200", "134348928", "268697856", "537395712",
]

function isRed(pocket: i32): boolean {
  return RED_POCKETS.includes(pocket)
}

function bitOf(pocket: i32): BigInt {
  return ONE.leftShift(u8(pocket))
}

function wheelIndexOf(pocket: i32): i32 {
  return EUROPEAN_WHEEL_ORDER.indexOf(pocket)
}

/** Masque des cases à une distance <= `distance` de `pocket` sur le cylindre (p inclus). */
function wheelNeighbourMask(pocket: i32, distance: i32): BigInt {
  const index = wheelIndexOf(pocket)
  let mask = ZERO
  for (let offset = -distance; offset <= distance; offset++) {
    mask = mask.bitOr(bitOf(EUROPEAN_WHEEL_ORDER[(index + offset + POCKET_COUNT) % POCKET_COUNT]))
  }
  return mask
}

/** Masque des cases 1..36 qui satisfont le critère `kind` par rapport à `previous`. */
function nonZeroMask(kind: i32, previous: i32): BigInt {
  const ending = previous % DECIMAL_BASE
  const below = (ending + DECIMAL_BASE - 1) % DECIMAL_BASE
  const above = (ending + 1) % DECIMAL_BASE
  let mask = ZERO
  for (let pocket = 1; pocket <= MAX_POCKET; pocket++) {
    let covered = false
    if (kind == ABOVE_PREVIOUS) covered = pocket > previous
    else if (kind == BELOW_PREVIOUS) covered = pocket < previous
    else if (kind == SAME_COLOUR_AS_PREVIOUS) covered = isRed(pocket) == isRed(previous)
    else if (kind == SAME_DOZEN_AS_PREVIOUS) covered = (pocket - 1) / DOZEN_SIZE == (previous - 1) / DOZEN_SIZE
    else if (kind == SAME_ENDING_AS_PREVIOUS) covered = pocket % DECIMAL_BASE == ending
    else if (kind == ADJACENT_ENDINGS_OF_PREVIOUS) covered = pocket % DECIMAL_BASE == below || pocket % DECIMAL_BASE == above
    else if (kind == OPPOSITE_COLOUR_OF_PREVIOUS) covered = isRed(pocket) != isRed(previous)
    else if (kind == OPPOSITE_PARITY_OF_PREVIOUS) covered = pocket % 2 != previous % 2
    if (covered) mask = mask.bitOr(bitOf(pocket))
  }
  return mask
}

/**
 * Masque d'un preset lié au tirage précédent `previous`, ou null quand il n'existe pas pour ce p
 * (couleur, douzaine, couleur et parité opposées quand p = 0 ; N invalide pour le 48).
 * `size` sert seulement au preset 48, dont N se déduit de |S| = 2N + 1.
 */
export function previousDrawPresetMask(presetId: i32, previous: i32, size: i32): BigInt | null {
  if (previous < 0 || previous > MAX_POCKET) return null
  if (presetId == NEIGHBOURS_OF_PREVIOUS) return wheelNeighbourMask(previous, NEIGHBOUR_DISTANCE)
  if (presetId == OPPOSITE_HALF_OF_PREVIOUS) {
    // Toutes les cases moins les voisines à distance <= 9 (sous-ensemble : la soustraction retire ses bits).
    return wheelNeighbourMask(previous, MAX_POCKET / 2).minus(wheelNeighbourMask(previous, OPPOSITE_HALF_MIN_DISTANCE - 1))
  }
  if (presetId == WITHIN_N_OF_PREVIOUS) {
    if (size % 2 == 0) return null
    const distance = (size - 1) / 2
    if (distance < MIN_WHEEL_DISTANCE || distance > MAX_WHEEL_DISTANCE) return null
    return wheelNeighbourMask(previous, distance)
  }
  const needsNonZero =
    presetId == SAME_COLOUR_AS_PREVIOUS ||
    presetId == SAME_DOZEN_AS_PREVIOUS ||
    presetId == OPPOSITE_COLOUR_OF_PREVIOUS ||
    presetId == OPPOSITE_PARITY_OF_PREVIOUS
  if (needsNonZero && previous == 0) return null
  if (presetId < ABOVE_PREVIOUS || presetId > OPPOSITE_PARITY_OF_PREVIOUS) return null
  return nonZeroMask(presetId, previous)
}

function staticPresetMask(presetId: i32): BigInt | null {
  const index = STATIC_PRESET_IDS.indexOf(presetId)
  if (index < 0) return null
  return BigInt.fromString(STATIC_PRESET_MASKS[index])
}

/**
 * presetId « canonique » d'une jambe valide (champs déjà extraits par `decodeMaskNumber`) : son
 * presetId s'il décrit vraiment le masque, sinon 0. Prend des champs bornés, jamais la valeur brute.
 */
export function canonicalPresetId(mask: BigInt, presetId: i32, guard: boolean, expectedPrev: i32, size: i32): i32 {
  const staticMask = staticPresetMask(presetId)
  if (staticMask !== null) {
    return !guard && staticMask.equals(mask) ? presetId : FREE_SELECTION_PRESET_ID
  }
  if (!guard) return FREE_SELECTION_PRESET_ID
  const rebuilt = previousDrawPresetMask(presetId, expectedPrev, size)
  return rebuilt !== null && rebuilt.equals(mask) ? presetId : FREE_SELECTION_PRESET_ID
}
