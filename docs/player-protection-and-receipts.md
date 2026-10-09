# Player protection and placement receipts

`RoulettePlacement` is an immutable observation of each engine `BetRecorded`: transaction hash + log index is its id. It links to the existing aggregate `RouletteBet`, user and market, with raw amount, block, timestamp and transaction hash. Multiple placements in one round no longer lose their individual proof links. Existing ticket totals are unchanged. Paginate by `id_gt`, `orderBy: id`, using 26 fetched rows to show 25 and detect a next page.

`PlayerProtection` is keyed by bank address + player address. BankVault events update limits, pending increases, self-exclusion and gross stake usage independently. Observing a limits change must not clear usage or exclusion. It is a **last observed snapshot**: elapsed time does not update an indexed entity. Use `playerLimits` on the vault for effective limits, UTC-day rollover and matured changes. No RPC calls or block handlers are added to the indexer.

The new fields require deploying a new subgraph version and re-indexing to retain every historical placement. The frontend expands these queries lazily and reports unsupported schemas and index failures as unavailable. Absence of a placement does not authorize retrying a transaction. Keep historical ABI event fragments when regenerating `MergedEvents.json`; some historical Funder events are absent from the current contracts source.

Validation: `graph codegen`, `graph build`, `node scripts/check-constants.mjs`, and `graph test` on a supported Linux runtime. The added Matchstick tests cover separate placements in one transaction and independent updates of per-wallet/per-bank protection. Windows can compile their AssemblyScript but cannot run the Matchstick binary; the existing pull-request CI runs the suite on Linux.
