# humanbase

A whitelabeled **Apollo.io** B2B contact API, exposed as an **x402 merchant** so autonomous
AI agents can pay per call in USDC (Base Sepolia) and pull people/company data. The buyer is a
**Privy** agent wallet that auto-pays the `402`s. Built for the Base + Privy hackathon.

```
apps/merchant/   Express — x402 v2 paywalled API that proxies Apollo (or a mock DB)
apps/agent/      Node reference buyer (x402 v1 — superseded by the Privy CLI below)
packages/shared/ Stable Person/Organization schema shared by both
```

## How it works

1. Agent POSTs to a merchant endpoint with no payment → merchant replies **402** with the
   x402 **v2** requirements in a base64 `payment-required` header (price, USDC asset, `payTo`,
   CAIP-2 network `eip155:84532`).
2. Agent signs an **EIP-3009** authorization with its Privy wallet and retries with an
   `X-PAYMENT` header.
3. The merchant's `@x402/express` middleware verifies + settles via the **facilitator**
   (`https://x402.org/facilitator`), then returns `200` + the data.

> **Protocol note:** we use the scoped **`@x402/*` v2** packages (`@x402/express`,
> `@x402/evm`, `@x402/core`) — the same generation Privy's agent-wallet CLI speaks. The legacy
> unscoped `x402-express` emits `x402Version: 1`, which v2 clients reject.

Pricing mirrors Apollo's credit ladder: search `$0.01–0.03`, person enrich `$0.05`, bulk
`$0.40`. Data source is swappable (`DATA_PROVIDER=apollo|mock`) behind one interface.

## Run the merchant

```bash
npm install
cp apps/merchant/.env.example apps/merchant/.env.local
#   DATA_PROVIDER=apollo + APOLLO_API_KEY   (or mock)
#   X402_ENABLED=true
#   MERCHANT_ADDRESS=0x…   (your USDC payTo wallet)
#   NETWORK=base-sepolia   FACILITATOR_URL=https://x402.org/facilitator
npm run dev                      # http://localhost:3100

# Discovery is free:
curl -s localhost:3100/.well-known/x402 | jq
curl -s localhost:3100/openapi.json | jq
```

### Expose it over public HTTPS

The Privy CLI (and most x402 clients) only connect to **public HTTPS** URLs — not
`http://localhost`. For local testing, tunnel it:

```bash
cloudflared tunnel --url http://localhost:3100   # prints https://<name>.trycloudflare.com
```

For production, deploy to Render/Railway/Fly (Express, not Vercel-native).

## Buy from it with a Privy agent wallet

Uses Privy's agent-wallet CLI (https://agents.privy.io/skill.md):

```bash
# 1. Log in (browser device-code approval) — provisions an agent wallet
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet login
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet list-wallets

# 2. Fund the ethereum wallet with Base-Sepolia USDC (Circle faucet). Gas is on the facilitator.

# 3. Pay per call — the CLI reads the 402, signs EIP-3009, retries:
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet fetch-x402 \
  "https://<your-tunnel>.trycloudflare.com/api/v1/people/enrich" \
  --method POST --header "Content-Type: application/json" \
  --body '{"first_name":"Tim","last_name":"Zheng","domain":"apollo.io"}' \
  --max-value 100000
```

## Verified end-to-end (Base Sepolia)

Privy wallet → 402 → EIP-3009 → facilitator settle → real Apollo data. On-chain settlements:

| Call | Price | Tx |
|---|---|---|
| people/search | 0.01 USDC | [0x842a…7cf4](https://sepolia.basescan.org/tx/0x842a72f51bba0bc496154ba7655ef5d237ac916855906cf47d225daa5f757cf4) |
| people/enrich | 0.05 USDC | [0x9306…b39c](https://sepolia.basescan.org/tx/0x9306bf35e10798597d4415403531bc9d8f7f00b73a530ffa8e716a2badc1b39c) |

## Endpoints

| Endpoint | Price | Returns |
|---|---|---|
| `POST /api/v1/people/search` | $0.01 | profiles (no email/phone) |
| `POST /api/v1/organizations/search` | $0.03 | firmographics |
| `POST /api/v1/people/enrich` | $0.05 | profile + verified email (+phone on request) |
| `POST /api/v1/people/bulk_enrich` | $0.40 | up to 10 enrichments |
| `POST /api/v1/organizations/enrich` | $0.03 | full company record |

Free: `GET /api/health`, `GET /.well-known/x402`, `GET /openapi.json`.

## Delivery attestation (zkTLS, optional)

`/people/enrich` can attach a **Reclaim zkTLS proof** that the data came from Apollo, returned
as a `provenance` field next to `person`. It's off by default — enable with `ATTEST_ENABLED=true`
plus a Reclaim `RECLAIM_APP_ID`/`RECLAIM_APP_SECRET` and the optional
`@reclaimprotocol/zk-fetch` + `js-sdk` packages. The proof is bound to the query via the proof
context (`contextMessage`) and is verifiable off-chain (`@reclaimprotocol/js-sdk`) or on-chain
(`packages/contracts/ReclaimDeliveryVerifier`, BUSL-1.1) against the canonical Reclaim verifier
on Base Sepolia.

On-chain, `packages/contracts/ReclaimDeliveryCondition` (BUSL-1.1) wraps that verifier as an
x402r [`ICondition`](packages/contracts/src/x402r/ICondition.sol): drop it into an operator's
`CAPTURE_PRE_ACTION_CONDITION` slot and **escrowed USDC only releases to the merchant when a
valid delivery proof, bound to that payment, is supplied** — no proof, no payout. See
`packages/contracts/README.md`.

> **Trust scope (intentional v1):** this proves the **merchant → Apollo** leg — that the merchant
> *fetched* real data — not that the buyer *received* it. Only the buyer can attest its own
> session, so a merchant could fetch good data, mint a valid proof, and still serve garbage. The
> trustless design flips this to buyer-side prove-bad-delivery gating a refund on an x402r escrow;
> `ReclaimDeliveryCondition` is the seam — the same operator slot later holds the inverse condition.
> Also note: while enabled, an attested enrich currently spends a second Apollo credit.

## Licensing

MIT for the whole repo **except** `packages/contracts/`, which is BUSL-1.1 (same terms/licensor
as [`BackTrackCo/x402r-contracts`](https://github.com/BackTrackCo/x402r-contracts)). See
`/LICENSE` and `packages/contracts/LICENSE`.
