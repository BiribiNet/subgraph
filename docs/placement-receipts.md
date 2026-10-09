# Placement receipts

`RoulettePlacement` is an immutable observation of each engine `BetRecorded`: transaction hash + log index is its id. It links to the existing aggregate `RouletteBet`, user and market, with raw amount, block, timestamp and transaction hash. Multiple placements in one round retain their individual proof links. Existing ticket totals are unchanged. Paginate by `id_gt`, `orderBy: id`, using 26 fetched rows to show 25 and detect a next page.

These fields require a new subgraph version and historical replay. The frontend loads receipts lazily and reports unsupported schemas and index failures as unavailable. Absence of a placement does not authorize retrying a transaction. Historical ABI event fragments are preserved.

Daily stake caps, session limits, self-exclusion and their indexation have been withdrawn. This change does not depend on contracts PR #47.

Validation: `graph codegen`, `graph build`, `node scripts/check-constants.mjs`, and Matchstick on Linux. The added test covers separate placements in one transaction. Windows can compile its AssemblyScript but cannot run the Matchstick binary; pull-request CI runs the suite on Linux.
