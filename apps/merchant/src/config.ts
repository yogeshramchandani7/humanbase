// Load env from .env.local then .env (Node 20.12+ built-in; no dotenv dep needed).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* file absent — fine */
  }
}

// Apollo issues separate Search and Enrichment keys. Accept either dedicated key,
// falling back to a single APOLLO_API_KEY if you only have one master key.
const apolloMaster = process.env.APOLLO_API_KEY;

// CDP API keys authenticate the Coinbase facilitator. When present, we route
// settlement through the CDP facilitator so paid routes auto-list in the x402
// Bazaar (and thus on agentic.market). Without them we fall back to the free
// x402.org facilitator (no Bazaar cataloging).
const cdpApiKeyId = process.env.CDP_API_KEY_ID;
const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET;

export const config = {
  port: Number(process.env.PORT ?? 3100),
  dataProvider: (process.env.DATA_PROVIDER ?? "mock").toLowerCase(),
  apolloSearchKey: process.env.APOLLO_SEARCH_API_KEY ?? apolloMaster,
  apolloEnrichKey: process.env.APOLLO_ENRICH_API_KEY ?? apolloMaster,
  // x402
  x402Enabled: (process.env.X402_ENABLED ?? "false").toLowerCase() === "true",
  merchantAddress: process.env.MERCHANT_ADDRESS as `0x${string}` | undefined,
  network: process.env.NETWORK ?? "base-sepolia",
  facilitatorUrl: process.env.FACILITATOR_URL,
  // zkTLS delivery attestation (optional). Proves the merchant -> Apollo leg.
  attest: {
    enabled: (process.env.ATTEST_ENABLED ?? "false").toLowerCase() === "true",
    appId: process.env.RECLAIM_APP_ID,
    appSecret: process.env.RECLAIM_APP_SECRET,
  },
  // CDP / Bazaar
  cdpApiKeyId,
  cdpApiKeySecret,
  useCdpFacilitator: Boolean(cdpApiKeyId && cdpApiKeySecret),
  /**
   * The canonical public origin of this merchant (e.g. the Railway URL), used as
   * the resource URL the Bazaar catalogs. When unset, the resource is derived
   * per-request from the incoming Host header.
   */
  publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, ""),
};
