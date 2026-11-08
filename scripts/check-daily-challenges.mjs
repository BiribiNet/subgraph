/**
 * Garde-fou : le catalogue des défis du jour et les masques des presets codés en
 * AssemblyScript doivent rester identiques à la définition partagée
 * docs/daily-challenges.json (copie identique dans frontend
 * lib/daily-challenges/definition.json). AssemblyScript ne lit pas de JSON : sans ce
 * contrôle, une divergence fausserait silencieusement les BRBpoints, donc le vote
 * Snapshot. Lancé par `yarn test`.
 *
 * Usage : node scripts/check-daily-challenges.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const definition = JSON.parse(readFileSync(join(root, "docs", "daily-challenges.json"), "utf8"));
const challengesTs = readFileSync(join(root, "src", "helpers", "daily-challenges.ts"), "utf8");
const presetsTs = readFileSync(join(root, "src", "helpers", "special-bet-presets.ts"), "utf8");

/** Valeurs d'un tableau littéral `export const NAME: T[] = [ ... ]`. */
function arrayLiteral(source, name) {
  const match = source.match(new RegExp(`const ${name}: \\w+\\[\\] = \\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`${name} introuvable`);
  return match[1].split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.replace(/^"|"$/g, ""));
}

/** Valeur d'une constante scalaire `const NAME: i32 = 3` ou `const NAME = BigInt.fromI32(10)`. */
function scalar(source, name) {
  const match = source.match(new RegExp(`const ${name}(?:: \\w+)? = (?:BigInt\\.fromI32\\()?(\\d+)`));
  if (!match) throw new Error(`${name} introuvable`);
  return Number(match[1]);
}

const failures = [];
function expectEqual(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label} : AssemblyScript ${JSON.stringify(actual)} ≠ JSON ${JSON.stringify(expected)}`);
  }
}

const catalogue = definition.catalogue;
expectEqual("CHALLENGE_IDS", arrayLiteral(challengesTs, "CHALLENGE_IDS").map(Number), catalogue.map((entry) => entry.id));
expectEqual("CHALLENGE_KINDS", arrayLiteral(challengesTs, "CHALLENGE_KINDS"), catalogue.map((entry) => entry.kind));
expectEqual("CHALLENGE_FAMILIES", arrayLiteral(challengesTs, "CHALLENGE_FAMILIES"), catalogue.map((entry) => entry.family ?? ""));
expectEqual("CHALLENGE_TARGETS", arrayLiteral(challengesTs, "CHALLENGE_TARGETS").map(Number), catalogue.map((entry) => entry.target));
const smallFree = catalogue.filter((entry) => entry.kind === "WIN_SMALL_FREE_SELECTION").map((entry) => entry.maxSize);
expectEqual("SMALL_FREE_SELECTION_MAX_SIZE", [scalar(challengesTs, "SMALL_FREE_SELECTION_MAX_SIZE")], smallFree);
expectEqual("CHALLENGES_PER_DAY", scalar(challengesTs, "CHALLENGES_PER_DAY"), definition.challengesPerDay);
expectEqual("POINTS_PER_CHALLENGE", scalar(challengesTs, "POINTS_PER_CHALLENGE"), definition.pointsPerChallenge);
expectEqual("SECONDS_PER_DAY", scalar(challengesTs, "SECONDS_PER_DAY"), definition.secondsPerDay);
expectEqual("NEIGHBOUR_PRESET_IDS", arrayLiteral(challengesTs, "NEIGHBOUR_PRESET_IDS").map(Number), definition.families.NEIGHBOURS.ids);
for (const [family, prefix] of [["THEMATIC", "THEMATIC"], ["ENDINGS", "ENDINGS"], ["PREVIOUS_DRAW", "PREVIOUS_DRAW"]]) {
  expectEqual(`${prefix}_MIN/MAX`, [scalar(challengesTs, `${prefix}_MIN`), scalar(challengesTs, `${prefix}_MAX`)], [definition.families[family].min, definition.families[family].max]);
}

const presetIds = arrayLiteral(presetsTs, "STATIC_PRESET_IDS");
const presetMasks = arrayLiteral(presetsTs, "STATIC_PRESET_MASKS");
expectEqual(
  "STATIC_PRESET_MASKS",
  Object.fromEntries(presetIds.map((id, index) => [id, `0x${BigInt(presetMasks[index]).toString(16)}`])),
  definition.staticPresetMasks,
);

if (failures.length > 0) {
  console.error("✖ docs/daily-challenges.json et l'AssemblyScript divergent :\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("✓ Défis du jour et presets alignés sur docs/daily-challenges.json");
