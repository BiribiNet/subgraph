# Paris spéciaux : statistiques par preset et défis du jour

Décision du propriétaire du 08/11/2026. Aucun changement de contrat : tout se déduit des
`BetRecorded` (jambes `BET_MASK = 16`) et des `VRFResult` déjà indexés.

## Preset canonique

`RouletteMaskLeg.presetId` est une donnée libre que le moteur ne lit jamais : n'importe qui peut
étiqueter un masque arbitraire « nombres premiers ». `RouletteMaskLeg.canonicalPresetId` ne garde le
presetId que si le masque **est** ce preset (`src/helpers/special-bet-presets.ts`) :

| presetId | Famille | Règle |
|---|---|---|
| 0 | Sélection libre | toute jambe non reconnue |
| 1–12 | thématiques | masque statique, sans garde |
| 20–29 | finales | masque statique, sans garde |
| 40–44 | liés au tirage précédent | recalculés sur `expectedPrev`, garde = 1 |
| 45 | même finale que p | 1–36, 0 exclu |
| 46 | finales voisines de p | finales d − 1 et d + 1 modulo 10, 0 exclu |
| 47 | moitié opposée du cylindre | les 18 cases à distance 10..18 de p |
| 48 | à N cases de p | p et N voisins de chaque côté, N = (\|S\| − 1) / 2 ∈ [1, 17] |
| 49 / 50 | couleur / parité opposée à p | 0 exclu, inexistants si p = 0 |

Les ids sont figés (frontend `lib/mask-bets/presets.ts`, catalogue v2).

## UserSpecialBetStats

Une ligne par (utilisateur, marché, preset canonique), mise à jour au **premier** règlement de chaque
jambe (`settleMaskLegsOfRound`) : `betCount`, `winCount`, `totalWagered`, `totalWon` (gain brut, mise
incluse), `netResult = totalWon − totalWagered`. Par marché, car les montants sont en unités de l'actif
du marché (comme `UserMarketStats`). Tous les paris réels comptent, même sous la mise minimale.

## Défis du jour

Définition partagée : [`daily-challenges.json`](./daily-challenges.json), copie **identique** de
frontend `lib/daily-challenges/definition.json`. `scripts/check-daily-challenges.mjs` (lancé par
`yarn test`) vérifie que les constantes AssemblyScript (`src/helpers/daily-challenges.ts`,
`src/helpers/special-bet-presets.ts`) n'en divergent pas ; `tests/daily-challenges.test.ts` et le test
frontend `test/unit/daily-challenges.test.ts` rejouent les mêmes vecteurs.

- 3 défis par jour UTC, 10 points chacun : 30 points au plus par jour et par joueur.
- Rotation : `défi(jour, slot) = catalogue[(jour × 3 + slot) mod 8]`, `jour = timestamp de placement / 86400`.
- Ne comptent que les jambes réglées dont la mise atteint `Market.minBet` au moment du pari
  (`RouletteMaskLeg.meetsMinBet`).
- Une jambe compte pour le jour de son **placement**, même réglée après minuit.
- Un défi n'est validé qu'une fois par jour et par joueur : `DailyChallengeCompletion`
  (id = utilisateur + jour + défi) est la clé de déduplication, vérifiée avant toute attribution.
- Un `VRFResult` rejoué ne recompte pas une jambe déjà réglée (`payout` déjà renseigné).

| id | Défi | Règle |
|---|---|---|
| 1 | Gagne 3 paris spéciaux différents | 3 presets canoniques distincts gagnés (la Sélection libre compte pour un) |
| 2 | Gagne un pari lié au tirage précédent | un preset 40–50 gagné |
| 3 | Gagne une Sélection libre de 5 numéros ou moins | preset 0, \|S\| ≤ 5, gagné |
| 4 | Joue des paris spéciaux sur 3 tours différents | 3 tours globaux distincts |
| 5 | Gagne un pari Finales | un preset 20–29 gagné |
| 6 | Gagne un pari thématique | un preset 1–12 gagné |
| 7 | Joue 5 paris spéciaux | 5 jambes réglées |
| 8 | Gagne un pari Voisins | preset 42 ou 48 gagné |

## BRBpoints et vote Snapshot

`User.challengePoints` (10 par défi) entre dans `computeBrbPoints` avec
`BRBPointsConfig.challengeWeight` (1 par défaut, sans diviseur : ce sont déjà des points). `brbpPoints`,
`tier` et `UserDailyPoints` sont recalculés ensemble, comme pour les tips. Comme `User.brbpPoints` est
l'oracle de vote Snapshot, les défis entrent dans la voix (décision du propriétaire du 08/11/2026).

## Mise en production

Nouveaux champs obligatoires (`User.challengePoints`, `User.challengeCount`,
`BRBPointsConfig.challengeWeight`, `RouletteMaskLeg.canonicalPresetId` / `meetsMinBet`) : la release
exige une **ré-indexation complète** depuis les `startBlock`, **sans greffe**. Changer le catalogue, la
rotation ou les points plus tard exige aussi une ré-indexation complète et la mise à jour simultanée du
frontend.
