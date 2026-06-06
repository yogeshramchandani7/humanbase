# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A whitelabeled **Apollo.io** B2B contact API exposed as an **x402 merchant**: AI agents pay
per call in USDC on **Base Sepolia** to get people/company data. The merchant proxies the real
Apollo API (or a mock DB) and gates every paid endpoint behind x402. The reference buyer is a
**Privy agent wallet** that auto-pays the `402`s.

On top of the paid API the repo also has the **trust layer (M6)**: a **zkTLS delivery proof**
(Reclaim) that the merchant fetched real data, an on-chain verifier + an **x402r auth-capture
escrow** condition that releases payment only when that proof verifies (and refunds otherwise),
and a **hackathon demo UI** (`apps/demo`) that shows the settle-vs-refund story end to end. The
full escrow loop is validated on a Base Sepolia fork; see "x402r escrow" and "Status" below.

## Commands

Uses **npm workspaces** (not pnpm — corepack is broken on the dev machine, `~/.cache` is
root-owned). Run from the repo root.

```bash
npm install                 # install all workspaces
npm run dev                 # merchant w/ hot reload (tsx watch) → :3100
npm start                   # merchant, no reload
npm run typecheck -w apps/merchant   # typecheck (tsc is the gate for the TS apps)
npm run typecheck -w apps/agent
npm run demo                # hackathon demo UI → :4000 (auto-starts merchant paywall-off; see apps/demo)
```

For the **TS apps** there is no test suite/linter — `tsc --noEmit` is the only static check;
verify by running the server and hitting it with `curl` / the Privy CLI. **`packages/contracts`
is Foundry** and DOES have tests:

```bash
export PATH="$HOME/.foundry/bin:$PATH"          # foundryup installs here
cd packages/contracts && forge install foundry-rs/forge-std   # lib/ is gitignored — install once
forge build && forge test                       # 18 tests; tsc is not the gate here
forge script script/Deploy.s.sol:Deploy --rpc-url base-sepolia --broadcast --private-key $PK
```

The **escrow flow is exercised by harness scripts** (run against a fork — `anvil --fork-url
https://sepolia.base.org`, then `forge create` our verifier+condition):
`scripts/fork-check-condition.mjs` (proof → condition, 5 checks), `scripts/fork-escrow-loop.mjs`
(full authorize→release/refund loop), `scripts/capture-demo-hashes.mjs` (writes real tx hashes
into the demo fixtures).

### Running the agent / paying for real
The buyer is **Privy's agent-wallet CLI**, not `apps/agent` (see below):
```bash
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet login        # browser device-code
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet list-wallets
npx -y -p @privy-io/agent-wallet-cli privy-agent-wallet fetch-x402 <https-url> --method POST --body '{...}' --max-value 100000
```
The CLI **only connects to public HTTPS** — it refuses `http://localhost` and private IPs. To
test against the local merchant, tunnel it: `cloudflared tunnel --url http://localhost:3100`.

## Architecture

Workspaces (`packages/*`, `apps/*`):
- `packages/shared` — the zod **Person/Organization schema** + request schemas (+ `Provenance`).
  The stable contract; apps import it as `@humanbase/shared`.
- `packages/contracts` — **Foundry** (BUSL-1.1). The on-chain trust layer: `ReclaimDeliveryVerifier`,
  the x402r `ReclaimDeliveryCondition` (`ICondition`), `IReclaim`, `Deploy.s.sol`. (See "x402r escrow".)
- `apps/merchant` — Express + TypeScript. The x402-gated seller (+ zkTLS attestation).
- `apps/agent` — an older programmatic buyer (see caveat below).
- `apps/demo` — the hackathon demo UI (plain Express + vanilla JS, no build). (See "apps/demo".)

### Merchant data flow
`src/server.ts` wires: `express.json()` → free routes (`/api/health`, discovery) →
`buildPaymentMiddleware()` (the paywall) → `/api/v1` router → error handler.

Two seams matter most:

1. **Provider abstraction** (`src/providers/`). `types.ts` defines `DataProvider`;
   `apollo.ts` proxies the real Apollo API and **normalizes** its responses into the shared
   schema; `mock.ts` is a deterministic faker honoring the same filters. `index.ts` is a cached
   factory that picks Apollo vs mock from `DATA_PROVIDER`, falling back to mock if no key.
   **All endpoints return the shared schema regardless of source** — when adding a field,
   change `packages/shared` and update both providers' normalizers.

2. **Pricing as single source of truth** (`src/pricing.ts`). `ENDPOINTS` lists every paid route
   with its USD price and description. It feeds BOTH the x402 paywall (`src/x402.ts`) and the
   discovery manifest/OpenAPI (`src/discovery.ts`) so price and metadata never drift. Add a paid
   endpoint here, add its route in `src/routes.ts`, and both the paywall and discovery pick it up.

### x402: use v2, not v1 (critical)
The x402 ecosystem has **two incompatible generations**. The merchant MUST use the scoped
**`@x402/*` v2** packages (`@x402/express`, `@x402/evm`, `@x402/core`) — the legacy unscoped
`x402`/`x402-express` emit `x402Version: 1`, which v2 clients (including the Privy CLI) reject
with "No client registered for x402 version: 1".

v2 specifics (in `src/x402.ts`):
- Networks are **CAIP-2** (`eip155:84532` = base-sepolia; `eip155:8453` = base mainnet). The
  `CAIP2` map converts the friendly `NETWORK` env value.
- Wiring: `new x402ResourceServer(new HTTPFacilitatorClient({url})).register(network, new ExactEvmScheme())`,
  then `paymentMiddleware(routes, server)` with routes shaped `{accepts:{scheme,price,network,payTo}, description}`.
- v2 returns the requirements in a base64 **`payment-required` response header** (the 402 body
  is `{}`) — don't expect them in the body.
- **Facilitator is selected at runtime** (`buildFacilitator()` in `src/x402.ts`): if
  `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` are set we use the **Coinbase CDP facilitator**
  (required for Bazaar listing — see below); otherwise we fall back to the free
  `https://x402.org/facilitator`. (The `@x402/express` README's `facilitator.x402.org` does not
  resolve — don't use it.)
- The paywall is gated behind `X402_ENABLED`; false → no-op passthrough so the API runs open in dev.

### Discovery & the x402 Bazaar (agentic.market)
We list humanbase on **agentic.market**, which is **Bazaar-fed** — there is no seller form. A
route is cataloged the **first time it settles through the CDP facilitator** AND declares Bazaar
discovery metadata. So two things are required together:

1. **CDP facilitator** (above) — set the CDP keys.
2. **Discovery metadata per route** (`src/x402.ts`): we `registerExtension(bazaarResourceServerExtension)`
   on the resource server, and each route carries `serviceName`/`tags`/`mimeType` plus
   `extensions: { ...declareDiscoveryExtension({ bodyType:"json", input, inputSchema, output }) }`.
   The actual metadata (tags + request/response examples + JSON Schemas) lives in
   `src/pricing.ts` under each endpoint's `discovery` field, keeping pricing the single source.

**GOTCHA:** the v2 `HTTPFacilitatorClient` does **not** auto-read CDP env vars (the CDP
seller-quickstart doc is wrong). CDP needs JWT auth, supplied via `@coinbase/x402`'s
`createFacilitatorConfig(id, secret)` (builds `createAuthHeaders` for verify/settle/supported).
We deliberately **omit** the permit2 / EIP-2612 gas-sponsoring extension from that doc — it
changes the transfer method and would break the EIP-3009 Privy CLI buyer.

Debug a live endpoint at `https://agentic.market/validate`. Extra deps for this:
`@x402/extensions`, `@coinbase/x402` (both 2.x).

### `apps/agent` caveat
`apps/agent` is a programmatic buyer (`x402-fetch` v1 + a Privy/local viem signer in
`signer.ts`). It is **x402 v1 and therefore incompatible with the current v2 merchant** —
superseded by the Privy CLI. Don't treat it as the working path; either upgrade it to
`@x402/fetch` v2 or retire it.

### zkTLS delivery attestation (`apps/merchant/src/attestation/reclaim.ts`)
Optional **Reclaim zkFetch** proof that the merchant fetched real, non-empty Apollo data, attached
to `/people/enrich` responses as a `provenance` field. Gated behind `ATTEST_ENABLED` (off by
default); degrades to `null` on any failure so the paid API keeps working. The Reclaim deps are
**optionalDependencies** (`@reclaimprotocol/zk-fetch`, `js-sdk`), imported via dynamic `import()`.
- The Reclaim **app must be registered + zk-enabled** at dev.reclaimprotocol.org (else
  `fetchAppById` 404s "Application not found"). `RECLAIM_APP_ID` is an address; `RECLAIM_APP_SECRET`
  is the private key that derives it.
- The "good data" predicate is a regex requiring a populated `"person":{… "id":"…"}`; the proof
  commits a query **marker** (`sha256(body)`) into `context.contextMessage`.
- COST/latency: enabling it spends a **second** Apollo enrich credit and adds ~25s (proof gen) per
  call — keep it opt-in, not always-on, for a live API.
- The proof's `onchain` field is the `IReclaim.Proof` struct (`{claimInfo, signedClaim}`) the
  on-chain verifier consumes; it passes the canonical Reclaim verifier on Base Sepolia
  (`0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5`).

### x402r escrow (M6) — `packages/contracts` + the off-chain loop
`ReclaimDeliveryCondition` implements the x402r **`ICondition`** so escrow **release/capture** is
gated on a valid delivery proof (`check()` decodes `(IReclaim.Proof, marker)` from the per-action
bytes, verifies via `ReclaimDeliveryVerifier`, and with `BIND_MARKER_TO_SALT` requires
`paymentInfo.salt == keccak256(marker)` so a proof can't be replayed). Non-reverting view.

The off-chain wiring (see harness scripts) uses the scoped **`@x402r/core` + `@x402r/evm`** SDKs
(there is **no `@x402r/express`**). Hard-won specifics:
- **Canonical x402r infra is already deployed on Base Sepolia** — get it via `getChainConfig(84532)`
  from `@x402r/core`: AuthCaptureEscrow `0xBC151792f80C0EB1973d56b0235e6bee2A60e245`, ERC-3009
  tokenCollector `0x9A12A116a44636F55c9e135189A1321Abcfe2f30`, operator factory
  `0x3Cd5c76Fefe46CB07788Ee8f80B93B20D81941D4`, condition singletons (`alwaysTrue`, …). Reuse them.
- We deploy only (a) our verifier+condition and (b) a **custom operator** via `deployOperator({
  factoryAddress, config })` with `OperatorConfig.releaseCondition` = our condition.
- The seller advertises the **commerce scheme** (`registerCommerceEvmScheme`) with an `EscrowExtra`;
  capture = `release(walletClient, {operatorAddress, paymentInfo, amount, data})`, refund =
  `refundInEscrow(...)`. Buyer signs ERC-3009 via `signReceiveAuthorization(...)`.
- **GOTCHA 1 — feeReceiver:** the operator's `validFees` requires `paymentInfo.feeReceiver ==
  the operator's own address` (not the EOA/zero). `feeCalculator` may be `zeroAddress` (0 fee).
- **GOTCHA 2 — clean EOA buyer:** the buyer that signs ERC-3009 MUST be a clean EOA. The well-known
  anvil/hardhat accounts (`0xf39F…2266`, `0x7099…79C8`) are **EIP-7702-delegated on Base Sepolia**
  (23 bytes of code) → USDC verifies via ERC-1271 → "FiatTokenV2: invalid signature". Generate a
  fresh key. (USDC EIP-712 domain is `("USDC","2",84532)`; funds land in a **TokenStore**, not the
  escrow address — assert on payer/receiver balances.)
- USDC on Base Sepolia = `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (balanceOf storage slot 9 for
  fork funding via `anvil_setStorageAt`).

### `apps/demo` (hackathon demo UI)
`npm run demo` → demo on :4000; it **auto-spawns the merchant on :3100 with the paywall OFF**
(`X402_ENABLED=false ATTEST_ENABLED=false DATA_PROVIDER=apollo`; set `DEMO_NO_SPAWN=1` to manage it
yourself; the spawn **pins `PORT`** so it doesn't inherit the demo's). Two side-by-side panels:
Request A (data exists → SETTLED + person + zkTLS proof) vs Request B (no record → REFUNDED +
payment & refund hashes). **Design = live merchant enrich + replayed escrow:** the UI's backend
makes a real `POST /people/enrich` (real Apollo data / a "no verified contact" miss — note Apollo
never truly 404s, it returns a hollow shell with no email, so a miss = no email), with a graceful
fixture fallback if the merchant is down. Escrow tx hashes + the proof are **replayed** from
`apps/demo/fixtures/escrow-{found,notfound}.json`, captured by `scripts/capture-demo-hashes.mjs`.
Those are **fork** tx hashes (real, but not on basescan) → chips show the full hash, non-clickable
(`explorerLinkable:false`); to make them basescan-clickable, re-capture against real testnet and
flip the flag. Previewed via the `humanbase-demo` config in the repo-parent `.claude/launch.json`.

## Config / secrets

Env is loaded from `.env.local` then `.env` via Node's built-in `process.loadEnvFile` (see
each app's `config.ts` / `env.ts`). Both are git-ignored. Merchant keys: `DATA_PROVIDER`
(`apollo`|`mock`), `APOLLO_API_KEY` (single key covers search + enrich; `ApolloProvider` also
accepts split `APOLLO_SEARCH_API_KEY`/`APOLLO_ENRICH_API_KEY`), `X402_ENABLED`,
`MERCHANT_ADDRESS` (USDC payTo), `NETWORK`, `FACILITATOR_URL`. For Bazaar listing also:
`CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (CDP Secret API key from portal.cdp.coinbase.com →
Secret API Keys), and `PUBLIC_URL` (the stable public origin, e.g. the Railway URL — used as the
canonical resource URL the Bazaar catalogs; falls back to the request Host when unset). For zkTLS
attestation: `ATTEST_ENABLED` (default false), `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET` (registered +
zk-enabled at dev.reclaimprotocol.org). Foundry/contract deploys read `ETHERSCAN_API_KEY` (verify)
and a deployer `--private-key`.

## Deploy

Express is **not Vercel-native** — deploy to **Railway** (chosen) / Render / Fly. (`cloudflared`
tunnels are for local testing only; the URL is ephemeral.) Start command:
`npm run start -w apps/merchant`. Set all merchant env on the host, including the CDP keys and
`PUBLIC_URL`.

## Status & roadmap

**Done:** M1–M5 (merchant + Apollo proxy + x402 v2 paywall + Privy CLI paid loop verified
on-chain + discovery manifest/OpenAPI). x402 Bazaar / agentic.market wiring code-complete (CDP
facilitator + discovery metadata), verified locally.

**M6 escrow + trust layer — DONE & merged to `main`** (PR #1): zkTLS attestation, the Foundry
contracts (verifier + x402r condition; `forge test` 18/18), and the demo UI. The **full x402r
auth-capture loop is validated on a Base Sepolia fork**: real Reclaim proof passes our condition
against the canonical Reclaim verifier; `authorize → release(proof)` captures; a payment with no
valid proof can't capture and `refundInEscrow` returns the funds ("no proof, no money"). The
merchant still serves the plain `ExactEvmScheme` paywall — it is **not yet wired to escrow over
HTTP** (that needs a commerce facilitator).

**Next:**
1. **Clickable, verifiable hashes:** re-run the capture against **real Base Sepolia** (fund a fresh
   clean EOA — see GOTCHA 2 — with testnet ETH + USDC), then set `explorerLinkable:true` in the demo
   fixtures so they link to basescan.
2. **Wire the merchant to escrow over HTTP:** register the commerce scheme + advertise `EscrowExtra`,
   and **run our own commerce-capable facilitator** (CDP/x402.org facilitators only do `exact`).
3. **Deploy to Railway** with a stable HTTPS URL (`PUBLIC_URL`) and finish the agentic.market listing
   (one real paid settle through CDP → cataloging → verify at agentic.market/validate).
