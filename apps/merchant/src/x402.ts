import type { RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer, type Network } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { ENDPOINTS } from "./pricing";
import { config } from "./config";

/** Friendly network name → CAIP-2 id (what x402 v2 uses on the wire). */
const CAIP2: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

/**
 * Builds the x402 v2 paywall from the pricing catalog.
 *
 * We deliberately use the scoped `@x402/*` (v2, x402Version 2) packages — the same
 * generation Privy's agent-wallet CLI speaks — so a v2 client can pay our 402s.
 * (The legacy unscoped `x402-express` emits x402Version 1, which v2 clients reject.)
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
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

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
    };
  }

  return paymentMiddleware(routes, server);
}
