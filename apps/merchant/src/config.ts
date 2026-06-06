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
};
