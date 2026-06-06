# humanbase — hackathon demo UI

A web UI that demos the x402r escrow + zkTLS-delivery story with two agent requests, side by side:

- **Request A · data exists** (Tim Zheng @ apollo.io) → green trace → returns the contact + a
  **zkTLS proof verified** badge → escrow **SETTLED** to humanbase (settlement tx hash).
- **Request B · no record** (a person with no verified contact) → red trace → no proof can be minted
  → escrow release blocked → **x402r REFUNDS** the agent (initial payment hash + refund hash).

## Run it (one command)

```bash
npm run demo
```

That starts the demo on **http://localhost:4000** and auto-starts the merchant on :3100 with the
paywall off (provider=apollo). Open the page and click **▶ Run agent request** on each panel.

- Already running your own merchant? Set `DEMO_NO_SPAWN=1 npm run demo`.
- Needs `apps/merchant/.env.local` with a real `APOLLO_API_KEY` for the live enrich (Request A).

## What's real vs replayed (by design, for stage reliability)

- **LIVE** — the merchant HTTP enrich is a real `POST /people/enrich`: real Apollo data on the hit,
  a real "no verified contact" on the miss. Falls back to a captured fixture only if the merchant is
  down (so the demo never hard-fails).
- **REPLAYED** — the on-chain escrow tx hashes + the zkTLS proof come from
  `fixtures/escrow-{found,notfound}.json`. These were captured from a real run on a Base Sepolia
  **fork** (`scripts/capture-demo-hashes.mjs`), which exercises the real x402r escrow, the real
  canonical Reclaim verifier, and the real `authorize → release(proof)` / `authorize → refundInEscrow`
  paths. Fork tx hashes don't resolve on basescan, so chips are display-only (`explorerLinkable:false`).

## Re-capture hashes (optional)

```bash
# 1) start an anvil fork + deploy our contracts (see scripts/), then:
node scripts/capture-demo-hashes.mjs   # writes real payment/settle/refund hashes into the fixtures
```
To get **clickable** basescan links, run the capture against real Base Sepolia (funded clean-EOA key)
and set `explorerLinkable: true` in the fixtures.

## Stage tips

- Pre-start `npm run demo` before you go up (merchant boot + first Apollo call warms in a few seconds).
- Keep a screen-recording of a clean run as a backup.
- The contrast is the pitch: green **SETTLED + data + proof** vs red **REFUNDED + two hashes**.
