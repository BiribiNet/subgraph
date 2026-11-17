<img src="https://raw.githubusercontent.com/BiribiNet/contracts/d2fb7981f6aeafea22c9683d8871badc3fa04c6e/docs/listing-assets/biribi-logo-200.png" alt="Biribi chip logo" width="80" height="80">

# Biribi subgraph

This subgraph indexes Biribi’s onchain roulette and bankroll vaults on Arbitrum. It turns contract events into a read-only GraphQL dataset for exploring draws, bets, payouts, and vault activity across BRB, native USDC, and DAI markets.

🎡 [Explore Biribi](https://biribi.net) · 🔎 [Inspect onchain evidence](https://biribi.net/infrastructure) · 📜 [Smart contracts](https://github.com/BiribiNet/contracts) · 🧩 [GraphQL schema](schema.graphql)

## Network configuration

| Network | Chain ID | Starting block | Deployment inputs |
| --- | --- | --- | --- |
| Arbitrum One | `42161` | [515103224](https://arbiscan.io/block/515103224) | [Mainnet manifest](deployments/arbitrum-one.json) · [ABI snapshot](deployments/arbitrum-one-abi.json) |
| Arbitrum Sepolia | `421614` | [284788460](https://sepolia.arbiscan.io/block/284788460) | [Testnet manifest](deployments/arbitrum-sepolia.json) · [Default subgraph config](subgraph.yaml) |

The mainnet build uses network-specific addresses, ABI layouts, and per-source start blocks. When exploring indexed data, check the indexed block and transaction hashes against the corresponding network’s transaction receipts.

### Arbitrum One markets

| Market ID | Asset | Token address | Bankroll vault proxy |
| --- | --- | --- | --- |
| 1 | BRB | [`0x58871cf545f8F0dF790443492a80EdC414df4504`](https://arbiscan.io/address/0x58871cf545f8F0dF790443492a80EdC414df4504) | [`0x5F9332b04b2590850c7681850cA445dDF7f64aa9`](https://arbiscan.io/address/0x5F9332b04b2590850c7681850cA445dDF7f64aa9) |
| 2 | USDC (native) | [`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`](https://arbiscan.io/address/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) | [`0x46206B1C1fc631Fd6Fcf2Aa2503f9cb022dA96bA`](https://arbiscan.io/address/0x46206B1C1fc631Fd6Fcf2Aa2503f9cb022dA96bA) |
| 3 | DAI | [`0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1`](https://arbiscan.io/address/0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1) | [`0x137dD55e422b1881Ad1566ce21E2E4F393bB37B2`](https://arbiscan.io/address/0x137dD55e422b1881Ad1566ce21E2E4F393bB37B2) |

### Mainnet event sources

| Contract | Address on Arbiscan | Indexed activity |
| --- | --- | --- |
| Roulette engine proxy | [`0xfC6474D1594952EF5BEB779b97BA69198b4e7625`](https://arbiscan.io/address/0xfC6474D1594952EF5BEB779b97BA69198b4e7625) | Market registration, bet placement, randomness, and settlement |
| Side-bet proxy | [`0x96e34298425c310422bFba424Bd4ed455b597D7f`](https://arbiscan.io/address/0x96e34298425c310422bFba424Bd4ed455b597D7f) | Offer configuration, bets, and settlement |
| Jackpot funder | [`0xd0083c4D3056F6D2bb2b98aEB4FEe0DD36C3bDB5`](https://arbiscan.io/address/0xd0083c4D3056F6D2bb2b98aEB4FEe0DD36C3bDB5) | Funding queues and conversions |
| BRB referral token | [`0x6d19c9d21CE7b2670fC5f142f27d9819DD888544`](https://arbiscan.io/address/0x6d19c9d21CE7b2670fC5f142f27d9819DD888544) | Referral token transfers |
| Upkeep scheduler | [`0xcf0c459014ffBa7DCc9026f15D5ADE1351092ef2`](https://arbiscan.io/address/0xcf0c459014ffBa7DCc9026f15D5ADE1351092ef2) | Scheduler settings and lane progress |
| Execution authority | [`0xc5C5A4b77652BA88853a1C3Ad4C6b04891ddd601`](https://arbiscan.io/address/0xc5C5A4b77652BA88853a1C3Ad4C6b04891ddd601) | Executor approvals |
| Tip jar | [`0xa65aD745721B0F1382653328b837EF75f79b99ce`](https://arbiscan.io/address/0xa65aD745721B0F1382653328b837EF75f79b99ce) | Voluntary tips |

## Explore the data

| What you want to find | GraphQL entities |
| --- | --- |
| Shared draw, VRF request, and winning number | `GlobalRound` |
| Market-specific rounds, tickets, and individual placements | `RouletteRound`, `RouletteBet`, `RoulettePlacement` |
| Observed roulette and jackpot payments | `PayoutTransaction`, `JackpotPayout` |
| Vault balances, shares, and withdrawal activity | `Market`, `VaultDeposit`, `VaultWithdrawal`, `LargeWithdrawalRequest` |
| Per-market activity and historical return observations | `MarketDailyStat`, `MarketReturnObservation` |
| Side-bet offers and settlement | `SideBetConfig`, `SideBet`, `SideBetSettlement` |

A draw result and a payment are separate events. Use the payment transaction hash to verify the token transfer. Vault withdrawal requests have their own lifecycle. Confirm the processing transaction and transfer when checking a withdrawal.

Amounts in per-market accounting fields are generally stored in raw token units. Use `Market.assetDecimals` to format them and retain the asset alongside each amount. See the [accounting notes](docs/accounting-v2.md) for field definitions, historical returns, and reconciliation.

For governance, Biribi’s [Snapshot integration](CLAUDE.md#dao--snapshot-voting-power) reads `User.brbpPoints` at the proposal’s snapshot block. Proposal and vote records live in Snapshot.

The source also supports [mask bet legs](https://github.com/BiribiNet/contracts/blob/master/docs/spec-mask-bets-v1.md) through `RouletteMaskLeg`. Unrecognized bet types are kept as `UNKNOWN`, with their raw numbers preserved. Check your endpoint’s deployed schema for field availability.

## Query markets and check freshness

Use this query with an endpoint you’re authorized to access. Biribi’s hosted Goldsky endpoints are private. The [infrastructure page](https://biribi.net/infrastructure) is the public entry point for indexed observations and transaction evidence.

```graphql
query BiribiMarkets {
  _meta {
    block { number hash }
    hasIndexingErrors
  }
  markets(first: 10, orderBy: marketId, orderDirection: asc) {
    marketId
    assetSymbol
    assetDecimals
    asset
    bank
  }
}
```

Compare `_meta.block.number` with the current chain head to measure indexing lag. For a reproducible export or reconciliation, pin the query and RPC reads to the same block and check the block hash.

## Develop locally

The local build uses Node.js 22 and Corepack. CI runs Matchstick 0.6.0 on Ubuntu 22.04.

```sh
git clone https://github.com/BiribiNet/subgraph.git
cd subgraph
corepack enable
yarn install --immutable
yarn codegen
yarn build
yarn test
```

| Resource | What it covers |
| --- | --- |
| [Schema](schema.graphql), [mappings](src/mappings/), and [tests](tests/) | Indexed entities, event handlers, and regression coverage |
| [Placement receipts](docs/placement-receipts.md) | Linking individual bet placements to their onchain transactions |
| [Deployment guide](DEPLOY.md) | Building an isolated mainnet bundle and validating it before promotion |
| [CI workflow](.github/workflows/ci.yml) | Release checks, schema code generation, tests, and WASM build |

For integration questions, contact [info@biribi.net](mailto:info@biribi.net).
