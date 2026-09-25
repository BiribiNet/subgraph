# Six additional BRBGAME types

Append-only contract indices: 9 DOZEN_PASSPORT, 10 BOOMERANG, 11 MIRROR_PAIR,
12 WHEEL_NEIGHBORS, 13 DISTINCT_COLLECTION, 14 COLOR_DUEL. Indices 0..8 remain stable.
The schema and `sideBetTypeFromI32` must be deployed before these configurations are
created. Event layouts and storage entity IDs are unchanged. The ABI adds only the
implementation's immutable evaluator getter; mapping logic does not depend on that getter.

Existing config reads snapshot rules and multipliers. Existing observation and settlement
handlers remain authoritative: do not derive a paid status from visual progress or a
winning-looking sequence. A replay may show fewer rounds than the window after early
settlement. Query and validate a staged version before switching the public endpoint.

Validation: graph codegen and graph build locally; the append-only mapping regression is
included in the existing Matchstick CI suite. Matchstick's native binary does not support
the Windows development host, so local build success is not claimed as a passing test run.
