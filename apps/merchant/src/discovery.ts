import { Router } from "express";
import { ENDPOINTS } from "./pricing";
import { config } from "./config";

/**
 * Free (un-paywalled) discovery surface so an agent can learn what's for sale and
 * what it costs before spending anything. Expanded with a full OpenAPI doc in M5.
 */
export const discoveryRouter = Router();

discoveryRouter.get("/.well-known/x402", (_req, res) => {
  res.json({
    x402Version: 1,
    name: "humanbase",
    description: "Human & company contact data for AI agents, pay-per-call over x402.",
    network: config.network,
    asset: "USDC",
    payTo: config.merchantAddress ?? null,
    paymentRequired: config.x402Enabled,
    openapi: "/openapi.json",
    endpoints: ENDPOINTS.map((e) => ({
      method: e.method,
      path: e.path,
      price: e.price,
      summary: e.summary,
      description: e.description,
      tags: e.discovery.tags,
    })),
  });
});

discoveryRouter.get("/openapi.json", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json(buildOpenApi(base));
});

/** Minimal OpenAPI 3.1 doc generated from the pricing catalog + shared entities. */
function buildOpenApi(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] = {
      post: {
        summary: e.summary,
        description: `${e.description}\n\n**Price:** ${e.price} (USDC on ${config.network}, paid via x402).`,
        operationId: e.path.split("/").slice(3).join("_"),
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": { description: "Success" },
          "402": {
            description:
              "Payment required — retry with an X-PAYMENT header (see the accepts array).",
          },
        },
        // x402 pricing as an OpenAPI extension so agents can read it off the spec.
        "x-402": { price: e.price, network: config.network, asset: "USDC" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "humanbase",
      version: "0.1.0",
      description:
        "Human & company contact data, sold per call to AI agents over the x402 protocol (USDC on Base).",
    },
    servers: [{ url: serverUrl }],
    paths,
  };
}
