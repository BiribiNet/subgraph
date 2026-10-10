# Append-only funky side-bet indexing

SideBetType appends ANY_REPEAT=21, ZIGZAG=22, ANY_DOZEN=23 and PHOTO_FINISH=24.
Existing 0–20 mappings remain unchanged. The event/tuple ABI is unchanged because the
enum is still encoded as uint8. Regenerate schema bindings and build before deployment.

Indexing preserves the existing ticket snapshot from getBet, configuration fallback,
consecutive observed spins and receipt-owned settlement. The subgraph never infers payment
from the condition or reconstructs prices. No new timer, settlement handler or owner action
is introduced. Six other proposed offers reuse existing indexed families.

Deploy this schema/mapping before enabling new config events. Follow the contracts
`docs/side-bet-funky.md` activation sequence. This PR is not a deployed Goldsky version.
The Matchstick enum regression covers 0–24; local Windows cannot run the native Matchstick
binary, so its execution belongs to supported Linux/macOS CI. Codegen/build can run locally.
