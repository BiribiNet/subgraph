/**
 * Phase 2 gate: compare a candidate Goldsky version against the live one before
 * the `prod` tag moves (see DEPLOY.md §4).
 *
 * Every Goldsky version re-indexes from `startBlock`, so a candidate rebuilds
 * the whole history with the new mappings. That is the point — data-correcting
 * deploys only take effect for history that is replayed — but it also means the
 * candidate can silently disagree with the live version on counters no fix was
 * supposed to touch. Moving the tag on such a version replaces a correct API
 * with a wrong one, and the prune that usually follows deletes the rollback.
 *
 * This reads both versions at the SAME block (time-travel) and reports:
 *   • indexing health of each version (health / synced / non-fatal errors)
 *   • every `GlobalState` field side by side, flagging the non-regression set
 *     (`totalRounds`, `totalBets`, `brbTotalSupply`) — no fix touches those, so
 *     any difference is an alarm, not an improvement
 *   • `totalPayouts` / `totalStakerRevenue` as a ratio of `totalWagered`; all
 *     three are 18-decimal, so a ~1e-12 gap is the cross-market decimal bug
 *   • per-market `totalAssets` / `stakerCount`, winners (`winCount > 0`) and
 *     stakers per market — a non-BRB market with zero winners is the payout
 *     attribution bug
 *   • the top `brbpPoints` holders, which are the Snapshot voting weights: any
 *     movement here changes governance retroactively and must be announced
 *   • entities present in the candidate's schema only, with their row counts,
 *     so a new data source that indexes nothing is visible before cutover
 *
 * Exit codes: 0 = comparable and non-regression holds, 1 = non-regression
 * broken (do NOT move the tag), 2 = not comparable yet (candidate still
 * syncing, or the versions share no queryable block).
 *
 * It reads only public data and mutates nothing — it never moves a tag.
 *
 * Usage:
 *   node scripts/validate-deploy.mjs [<live-version>] [<candidate-version>]
 *
 * Env:
 *   GOLDSKY_API_TOKEN     — Goldsky API token (required; GOLDSKY_TOKEN also read)
 *   GOLDSKY_SUBGRAPH_NAME — subgraph name (default: biribi)
 *   GOLDSKY_API_BASE      — override API base (default: https://api.goldsky.com)
 */

const token = (process.env.GOLDSKY_API_TOKEN ?? process.env.GOLDSKY_TOKEN ?? "").trim();
if (!token) {
  console.error(
    "validate-deploy: GOLDSKY_API_TOKEN is not set. Export it, or see DEPLOY.md §1 " +
    "for adding it as an environment secret.",
  );
  process.exit(1);
}

const apiBase = process.env.GOLDSKY_API_BASE ?? "https://api.goldsky.com";
const subgraphName = process.env.GOLDSKY_SUBGRAPH_NAME ?? "biribi";

// GlobalState is a singleton keyed by address(1) — see src/helpers/globalState.ts.
const GLOBAL_STATE_ID = "0x0000000000000000000000000000000000000001";

// Counters no data fix is allowed to move. A difference here is a regression.
const NON_REGRESSION = ["totalRounds", "totalBets", "brbTotalSupply"];

// Reorg margin: never pin the comparison to the very tip.
const REORG_MARGIN = 50;

const deployments = await (
  await fetch(`${apiBase}/api/admin/subgraph/v1/subgraphs/${subgraphName}/deployments`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();

const byVersion = new Map(deployments.data.map((entry) => [entry.version, entry]));

function pickVersions() {
  const [live, candidate] = process.argv.slice(2);
  if (live && candidate) return [live, candidate];
  // Default: highest version is the candidate, the one `prod` points at is live.
  const versions = [...byVersion.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (versions.length < 2) {
    console.error(
      `validate-deploy: need two deployed versions to compare, found ${versions.length}.`,
    );
    process.exit(1);
  }
  return [versions[versions.length - 2], versions[versions.length - 1]];
}

const [LIVE, CANDIDATE] = pickVersions();
for (const version of [LIVE, CANDIDATE]) {
  if (!byVersion.has(version)) {
    console.error(`validate-deploy: ${subgraphName}/${version} is not deployed.`);
    process.exit(1);
  }
}

const endpoint = (version) => apiBase + byVersion.get(version).graphql_endpoint;
const indexing = (version) =>
  byVersion.get(version).deployments?.[0]?.indexing_progress ?? {};

async function query(version, body) {
  const response = await fetch(endpoint(version), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: body }),
  });
  return response.json();
}

async function graphql(version, body) {
  const payload = await query(version, body);
  if (payload.errors) {
    throw new Error(`${version}: ${payload.errors.map((e) => e.message).join("; ")}`);
  }
  return payload.data;
}

console.log(`Comparing ${subgraphName}/${CANDIDATE} (candidate) against ${subgraphName}/${LIVE} (live)\n`);

console.log("Indexing health");
for (const version of [LIVE, CANDIDATE]) {
  const entry = byVersion.get(version);
  const progress = indexing(version);
  const nonFatal = entry.deployments?.[0]?.non_fatal_errors ?? [];
  console.log(
    `  ${version}: health=${entry.health} synced=${entry.synced} ` +
    `progress=${(progress.progress_percent ?? 0).toFixed(2)}% ` +
    `head=${progress.deployment_head_block} nonFatal=${nonFatal.length}`,
  );
  if (nonFatal.length > 0) console.log(`    ${JSON.stringify(nonFatal)}`);
}

/**
 * Goldsky prunes history: a version that has been live for a while only answers
 * time-travel queries over a rolling window of a few thousand blocks. Raise the
 * pin until both versions accept the same block, and bail out if the candidate
 * has not caught up to it yet — a comparison at different blocks is worse than
 * no comparison, because it looks like a result.
 */
async function resolvePinnedBlock() {
  const heads = [LIVE, CANDIDATE].map((v) => indexing(v).deployment_head_block ?? 0);
  let pin = Math.min(...heads) - REORG_MARGIN;
  for (let attempt = 0; attempt < 6; attempt++) {
    let raised = false;
    for (const version of [LIVE, CANDIDATE]) {
      const probe = await query(
        version,
        `{ globalState(id: "${GLOBAL_STATE_ID}", block: { number: ${pin} }) { id } }`,
      );
      const message = probe.errors?.[0]?.message ?? "";
      const pruned = message.match(/only has data starting at block number (\d+)/);
      const behind = message.match(/has only indexed up to block number (\d+)/);
      if (pruned) {
        pin = Number(pruned[1]);
        raised = true;
      } else if (behind) {
        console.error(
          `\n  ${version} has only indexed up to block ${behind[1]} — not comparable yet.`,
        );
        console.error("  Re-run once the candidate reports synced=true.");
        process.exit(2);
      } else if (message) {
        throw new Error(`${version}: ${message}`);
      }
    }
    if (!raised) return pin;
  }
  console.error("\n  Could not find a block both versions answer. Re-run in a few minutes.");
  process.exit(2);
}

const pin = await resolvePinnedBlock();
console.log(`\nComparison block (time-travel): ${pin}\n`);

// ── GlobalState ───────────────────────────────────────────────────────────────
const GLOBAL_STATE_QUERY = `{
  globalState(id: "${GLOBAL_STATE_ID}", block: { number: ${pin} }) {
    totalWagered totalBets totalRounds totalPlayers totalBurned
    totalPayouts totalStakerRevenue brbTotalSupply
    totalDeposited totalWithdrawn currentJackpot
  }
}`;

const [liveState, candidateState] = (
  await Promise.all([graphql(LIVE, GLOBAL_STATE_QUERY), graphql(CANDIDATE, GLOBAL_STATE_QUERY)])
).map((data) => data.globalState);

console.log("GlobalState");
console.log(`  ${"field".padEnd(22)} ${LIVE.padEnd(26)} ${CANDIDATE.padEnd(26)} verdict`);
const regressions = [];
for (const field of Object.keys(liveState ?? {})) {
  const identical = liveState[field] === candidateState[field];
  let verdict = identical ? "=" : "differs";
  if (NON_REGRESSION.includes(field)) {
    verdict = identical ? "ok (non-regression)" : "ALARM — must be identical";
    if (!identical) regressions.push(field);
  }
  console.log(
    `  ${field.padEnd(22)} ${String(liveState[field]).padEnd(26)} ` +
    `${String(candidateState[field]).padEnd(26)} ${verdict}`,
  );
}

// ── Decimal normalization ─────────────────────────────────────────────────────
// totalWagered, totalPayouts and totalStakerRevenue are all 18-decimal, so these
// ratios are O(1). A ~1e-12 result means raw market units leaked into a global.
const ratio = (numerator, denominator) =>
  BigInt(denominator) === 0n
    ? "n/a"
    : (Number((BigInt(numerator) * 10_000n) / BigInt(denominator)) / 10_000).toFixed(4);

console.log("\nDecimal normalization (all 18-decimal)");
for (const [label, state] of [[LIVE, liveState], [CANDIDATE, candidateState]]) {
  console.log(
    `  ${label}: totalPayouts/totalWagered=${ratio(state.totalPayouts, state.totalWagered)} ` +
    `totalStakerRevenue/totalWagered=${ratio(state.totalStakerRevenue, state.totalWagered)}`,
  );
}

// ── Markets ───────────────────────────────────────────────────────────────────
const MARKETS_QUERY = `{
  markets(block: { number: ${pin} }) {
    id assetSymbol assetDecimals assetClass totalAssets totalShares stakerCount
  }
}`;
const [liveMarkets, candidateMarkets] = (
  await Promise.all([graphql(LIVE, MARKETS_QUERY), graphql(CANDIDATE, MARKETS_QUERY)])
).map((data) => data.markets);

console.log("\nMarkets");
for (const market of candidateMarkets) {
  const before = liveMarkets.find((m) => m.id === market.id);
  console.log(
    `  [${market.id}] ${market.assetSymbol} (${market.assetDecimals}d, ${market.assetClass}) ` +
    `totalAssets=${market.totalAssets} shares=${market.totalShares} stakers=${market.stakerCount}`,
  );
  if (!before) {
    console.log(`        absent from ${LIVE}`);
  } else if (before.totalAssets !== market.totalAssets || before.stakerCount !== market.stakerCount) {
    console.log(`        ${LIVE}: totalAssets=${before.totalAssets} stakers=${before.stakerCount}`);
  }
}

// ── Payout attribution and staking weight, per market ─────────────────────────
console.log("\nWinners per market (winCount > 0)");
for (const market of candidateMarkets) {
  const body = `{
    userMarketStats_collection(
      first: 5, where: { market: "${market.id}", winCount_gt: "0" },
      orderBy: totalWon, orderDirection: desc, block: { number: ${pin} }
    ) { id winCount totalWon }
  }`;
  const [after, before] = await Promise.all([graphql(CANDIDATE, body), graphql(LIVE, body)]);
  console.log(
    `  [${market.id}] ${market.assetSymbol}: ${CANDIDATE} → ${after.userMarketStats_collection.length}, ` +
    `${LIVE} → ${before.userMarketStats_collection.length}`,
  );
  for (const row of after.userMarketStats_collection.slice(0, 3)) {
    console.log(`        ${row.id} winCount=${row.winCount} totalWon=${row.totalWon}`);
  }
}

console.log("\nStakers per market (totalStaked > 0)");
for (const market of candidateMarkets) {
  const body = `{
    userMarketStats_collection(
      first: 5, where: { market: "${market.id}", totalStaked_gt: "0" },
      orderBy: totalStaked, orderDirection: desc, block: { number: ${pin} }
    ) { id totalStaked }
  }`;
  const rows = (await graphql(CANDIDATE, body)).userMarketStats_collection;
  console.log(
    `  [${market.id}] ${market.assetSymbol}: ${rows.length} staker(s)` +
    (rows[0] ? ` top=${rows[0].id} totalStaked=${rows[0].totalStaked}` : ""),
  );
}

// ── Snapshot voting weight ────────────────────────────────────────────────────
const POINTS_QUERY = `{
  users(
    first: 5, where: { brbpPoints_gt: "0" },
    orderBy: brbpPoints, orderDirection: desc, block: { number: ${pin} }
  ) { id brbpPoints tier totalStaked totalRouletteBets winCount }
}`;
const [livePoints, candidatePoints] = (
  await Promise.all([graphql(LIVE, POINTS_QUERY), graphql(CANDIDATE, POINTS_QUERY)])
).map((data) => data.users);

console.log("\nTop brbpPoints (Snapshot voting weight)");
let pointsMoved = false;
for (const [label, rows] of [[LIVE, livePoints], [CANDIDATE, candidatePoints]]) {
  console.log(`  ${label}:`);
  for (const user of rows) {
    console.log(
      `    ${user.id} points=${user.brbpPoints} tier=${user.tier} ` +
      `staked=${user.totalStaked} wagered=${user.totalRouletteBets} winCount=${user.winCount}`,
    );
  }
}
for (const user of candidatePoints) {
  const before = livePoints.find((u) => u.id === user.id);
  if (!before || before.brbpPoints !== user.brbpPoints) pointsMoved = true;
}
console.log(
  pointsMoved
    ? "  Voting weight CHANGES with this version — cut over outside any voting window and announce it."
    : "  Voting weight is unchanged — no governance impact from this cutover.",
);

// ── Schema delta ──────────────────────────────────────────────────────────────
const QUERY_FIELDS = `{ __type(name: "Query") { fields { name } } }`;
const [liveFields, candidateFields] = (
  await Promise.all([graphql(LIVE, QUERY_FIELDS), graphql(CANDIDATE, QUERY_FIELDS)])
).map((data) => data.__type.fields.map((field) => field.name));

const added = candidateFields.filter((name) => !liveFields.includes(name));
const removed = liveFields.filter((name) => !candidateFields.includes(name));

console.log("\nSchema delta");
console.log(`  added:   ${added.length > 0 ? added.join(", ") : "none"}`);
console.log(`  removed: ${removed.length > 0 ? removed.join(", ") : "none"}`);
if (removed.length > 0) {
  console.log("  Removing a query field breaks consumers — confirm the frontend does not use these.");
}

// Row counts for the added collections, so a new data source that indexes
// nothing is visible here rather than after the tag has moved. An empty one is
// not automatically a bug: the source events may not exist on-chain yet.
const addedCollections = added.filter((name) => candidateFields.includes(name) && name.endsWith("s"));
if (addedCollections.length > 0) {
  console.log("\nRows in entities added by this version");
  for (const field of addedCollections) {
    try {
      const rows = (await graphql(CANDIDATE, `{ ${field}(first: 1000, block: { number: ${pin} }) { id } }`))[field];
      console.log(`  ${field.padEnd(30)} ${String(rows.length).padStart(5)}${rows.length === 0 ? "  empty" : ""}`);
    } catch (error) {
      console.log(`  ${field.padEnd(30)} query failed: ${String(error.message).slice(0, 100)}`);
    }
  }
  console.log("  An empty entity means no source event was seen — check the contract emits it before calling it a bug.");
}

// ── Verdict ───────────────────────────────────────────────────────────────────
console.log("\nVerdict");
if (regressions.length > 0) {
  console.log(`  REGRESSION on ${regressions.join(", ")} — do NOT move the prod tag.`);
  process.exit(1);
}
console.log(`  Non-regression holds on ${NON_REGRESSION.join(", ")}.`);
console.log(`  Cut over with: yarn prod:subgraph ${CANDIDATE}`);
console.log(`  Keep ${LIVE} deployed — it is the only rollback.`);
