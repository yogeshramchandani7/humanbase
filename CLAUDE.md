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
- Facilitator is `https://x402.org/facilitator` (the `@x402/express` README's
  `facilitator.x402.org` does not resolve). It hard-fails on startup if unreachable.
- The paywall is gated behind `X402_ENABLED`; false → no-op passthrough so the API runs open in dev.

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
`MERCHANT_ADDRESS` (USDC payTo), `NETWORK`, `FACILITATOR_URL`.

## Deploy

Express is **not Vercel-native** — deploy to Render/Railway/Fly. (`cloudflared` tunnels are for
local testing only; the URL is ephemeral.)
