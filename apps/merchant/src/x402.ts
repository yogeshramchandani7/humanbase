import type { RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer, type Network } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { declareDiscoveryExtension } from "@x402/extensions";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { ENDPOINTS } from "./pricing";
import { config } from "./config";

/** Friendly network name → CAIP-2 id (what x402 v2 uses on the wire). */
const CAIP2: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

/** Catalog service name shown in the Bazaar (≤32 printable-ASCII chars). */
const SERVICE_NAME = "humanbase";

/**
 * Picks the facilitator. With CDP API keys we use the Coinbase facilitator —
 * which is what catalogs paid routes into the x402 Bazaar (and onto
 * agentic.market) on first settlement. Without keys we fall back to the free
 * x402.org facilitator, which settles but does not feed the Bazaar.
 */
function buildFacilitator(): HTTPFacilitatorClient {
  if (config.useCdpFacilitator) {
    // Pass keys explicitly (rather than the env-reading default export) so we
    // don't depend on module-load ordering vs. config.ts's env loading.
    return new HTTPFacilitatorClient(
      createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret),
    );
  }
  return new HTTPFacilitatorClient({
    url: config.facilitatorUrl ?? "https://x402.org/facilitator",
  });
}

/**
 * Builds the x402 v2 paywall from the pricing catalog.
 *
 * We deliberately use the scoped `@x402/*` (v2, x402Version 2) packages — the same
 * generation Privy's agent-wallet CLI speaks — so a v2 client can pay our 402s.
 * (The legacy unscoped `x402-express` emits x402Version 1, which v2 clients reject.)
 *
 * Each route also declares a Bazaar discovery extension (input/output schemas +
 * examples from src/pricing.ts). Combined with the CDP facilitator, that makes
 * humanbase discoverable in the x402 Bazaar after the first paid call settles.
 *
 * When X402_ENABLED is false we return a no-op so the API runs open in dev.
 */
export function buildPaymentMiddleware(): RequestHandler {
  if (!config.x402Enabled) {
    return (_req, _res, next) => next();
  }
  if (!config.merchantAddress) {
    throw new Error("X402_ENABLED=true but MERCHANT_ADDRESS is not set");
  }

  const network = (CAIP2[config.network] ?? config.network) as Network;
  const server = new x402ResourceServer(buildFacilitator())
    .register(network, new ExactEvmScheme())
    // Enriches each route's declared discovery extension (sets method, etc.)
    // so the facilitator can catalog it in the Bazaar.
    .registerExtension(bazaarResourceServerExtension);

  const routes: RoutesConfig = {};
  for (const e of ENDPOINTS) {
    routes[`${e.method} ${e.path}`] = {
      accepts: {
        scheme: "exact",
        price: e.price,
        network,
        payTo: config.merchantAddress,
      },
      description: e.description,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: e.discovery.tags,
      // Stable resource URL for the catalog when we know our public origin;
      // otherwise the middleware derives it from the request Host.
      ...(config.publicUrl ? { resource: `${config.publicUrl}${e.path}` } : {}),
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: e.discovery.input,
          inputSchema: e.discovery.inputSchema,
          output: {
            example: e.discovery.output.example,
            schema: e.discovery.output.schema,
          },
        }),
      },
    };
  }

  return paymentMiddleware(routes, server);
}
