# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A whitelabeled **Apollo.io** B2B contact API exposed as an **x402 merchant**: AI agents pay
per call in USDC on **Base Sepolia** to get people/company data. The merchant proxies the real
Apollo API (or a mock DB) and gates every paid endpoint behind x402. The reference buyer is a
**Privy agent wallet** that auto-pays the `402`s.

## Commands

Uses **npm workspaces** (not pnpm — corepack is broken on the dev machine, `~/.cache` is
root-owned). Run from the repo root.

```bash
npm install                 # install all workspaces
npm run dev                 # merchant w/ hot reload (tsx watch) → :3100
npm start                   # merchant, no reload
npm run typecheck -w apps/merchant   # typecheck (there are no tests; tsc is the gate)
npm run typecheck -w apps/agent
```

There is **no test suite, build step, or linter** — `tsc --noEmit` is the only static check.
Verification is done by running the server and hitting it with `curl` / the Privy CLI.

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

Three workspaces:
- `packages/shared` — the zod **Person/Organization schema** + request schemas. The stable
  contract; both apps import it as `@humanbase/shared`.
- `apps/merchant` — Express + TypeScript. The x402-gated seller.
- `apps/agent` — an older programmatic buyer (see caveat below).

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

## Config / secrets

Env is loaded from `.env.local` then `.env` via Node's built-in `process.loadEnvFile` (see
each app's `config.ts` / `env.ts`). Both are git-ignored. Merchant keys: `DATA_PROVIDER`
(`apollo`|`mock`), `APOLLO_API_KEY` (single key covers search + enrich; `ApolloProvider` also
accepts split `APOLLO_SEARCH_API_KEY`/`APOLLO_ENRICH_API_KEY`), `X402_ENABLED`,
`MERCHANT_ADDRESS` (USDC payTo), `NETWORK`, `FACILITATOR_URL`. For Bazaar listing also:
`CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (CDP Secret API key from portal.cdp.coinbase.com →
Secret API Keys), and `PUBLIC_URL` (the stable public origin, e.g. the Railway URL — used as the
canonical resource URL the Bazaar catalogs; falls back to the request Host when unset).

## Deploy

Express is **not Vercel-native** — deploy to **Railway** (chosen) / Render / Fly. (`cloudflared`
tunnels are for local testing only; the URL is ephemeral.) Start command:
`npm run start -w apps/merchant`. Set all merchant env on the host, including the CDP keys and
`PUBLIC_URL`.

## Status & roadmap

**Done:** M1–M5 (merchant + Apollo proxy + x402 v2 paywall + Privy CLI paid loop verified
on-chain + discovery manifest/OpenAPI). Renamed to humanbase, pushed to the private GitHub repo.
**x402 Bazaar / agentic.market wiring is code-complete** (CDP facilitator + discovery metadata)
and verified locally (typecheck clean; boots against CDP with no auth error; 402 is x402Version 2
with `serviceName`, `tags`, and the bazaar extension embedded).

**Next (to actually appear on agentic.market):**
1. (Recommended first) re-run the Privy CLI paid loop against the **CDP** facilitator via a
   cloudflared tunnel to confirm the swap didn't break the buyer (~$0.01 testnet USDC).
2. **Deploy to Railway** with a stable HTTPS URL; set `PUBLIC_URL`.
3. Make **one real paid call** on the deployed URL — settling through CDP triggers cataloging.
4. Verify the listing on `https://agentic.market` (and debug via `/validate`).

**Future — M6: x402r escrow** (https://www.x402r.org/): non-custodial auth-capture escrow +
refunds so payment is captured only on good delivery and refunded on bad/empty matches. Built on
the same `@x402/* v2` stack (`@x402r/helpers`: `authCaptureEscrow`, `tokenCollector`) — additive.
This is the "complete project" end goal.
