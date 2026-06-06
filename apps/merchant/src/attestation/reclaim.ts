// Merchant-side zkTLS delivery attestation via Reclaim's zkFetch.
//
// TRUST NOTE: this proves the merchant -> Apollo leg only — that the merchant fetched real,
// non-empty data from Apollo for the buyer's query. It does NOT prove the buyer received that
// data (only the buyer can attest its own session). Intentional v1 simplification; see
// packages/contracts/README.md. Everything here is gated behind ATTEST_ENABLED (off by default)
// and degrades to null on any failure so the paid API keeps working.

import { createHash } from "node:crypto";
import type { Provenance } from "@humanbase/shared";
import { config } from "../config";

const APOLLO_ENRICH_URL = "https://api.apollo.io/api/v1/people/match";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Minimal local typings for the optional Reclaim deps so this file typechecks and the merchant
// runs even when attestation is disabled or the packages aren't installed.
interface ReclaimClientLike {
  zkFetch(
    url: string,
    publicOptions: Record<string, unknown>,
    secretOptions?: Record<string, unknown>,
  ): Promise<unknown>;
}
interface ZkFetchModule {
  ReclaimClient: new (appId: string, appSecret: string) => ReclaimClientLike;
}
interface JsSdkModule {
  transformForOnchain: (proof: unknown) => unknown;
}

/** Deterministic marker that binds a proof to this query; also committed into the request. */
export function queryMarker(body: unknown): string {
  const json = JSON.stringify(body ?? {});
  return "0x" + createHash("sha256").update(json).digest("hex").slice(0, 32);
}

function reclaimVerifierFor(network: string): string {
  return network === "base"
    ? "0x8CDc031d5B7F148ab0435028B16c682c469CEfC3" // Base mainnet
    : "0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5"; // Base Sepolia
}

/**
 * Generate a Reclaim proof that Apollo returned a populated person for `body`.
 * Returns null when attestation is disabled, misconfigured, or the optional deps are
 * unavailable — callers must treat provenance as best-effort.
 *
 * COST NOTE: this currently makes its own attested Apollo enrich call, separate from the one in
 * ApolloProvider, so enabling it spends a second enrich credit per request. The optimization is
 * to route the primary fetch through zkFetch and parse the person from the proof; left as a
 * follow-up to keep this change surgical.
 */
export async function attestApolloEnrich(body: unknown): Promise<Provenance | null> {
  if (!config.attest.enabled) return null;
  if (!config.attest.appId || !config.attest.appSecret) return null;
  if (!config.apolloEnrichKey) return null;

  const marker = queryMarker(body);

  let zk: ZkFetchModule;
  let sdk: JsSdkModule;
  try {
    // Indirect specifiers: these are optionalDependencies that may be absent (zk-fetch has a
    // postinstall ZK-file download). A non-literal specifier keeps tsc from hard-resolving them.
    const zkSpec: string = "@reclaimprotocol/zk-fetch";
    const sdkSpec: string = "@reclaimprotocol/js-sdk";
    zk = (await import(zkSpec)) as unknown as ZkFetchModule;
    sdk = (await import(sdkSpec)) as unknown as JsSdkModule;
  } catch {
    console.warn("[attest] @reclaimprotocol packages not installed; skipping provenance");
    return null;
  }

  try {
    const client = new zk.ReclaimClient(config.attest.appId, config.attest.appSecret);

    // "Good data" predicate: a populated person id must appear in the response.
    const goodData = '"person":\\s*\\{[\\s\\S]*?"id":\\s*"(?<id>[^"]+)"';

    const proof = await client.zkFetch(
      APOLLO_ENRICH_URL,
      {
        method: "POST",
        headers: { accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        // Bind the proof to this query. contextMessage lands in the proof's `context`, which
        // ReclaimDeliveryVerifier checks on-chain.
        context: { contextAddress: config.merchantAddress ?? ZERO_ADDRESS, contextMessage: marker },
      },
      {
        // Secret options (per zk-fetch v1): the Apollo key is redacted from the proof, and the
        // response match/redaction predicate lives here — NOT in the public options.
        headers: { "x-api-key": config.apolloEnrichKey },
        responseMatches: [{ type: "regex", value: goodData }],
        responseRedactions: [{ regex: goodData }],
      },
    );

    return {
      marker,
      proof,
      onchain: sdk.transformForOnchain(proof),
      verifier: { network: config.network, address: reclaimVerifierFor(config.network) },
    };
  } catch (err) {
    console.warn("[attest] proof generation failed; serving without provenance:", err);
    return null;
  }
}
