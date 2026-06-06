import express from "express";
import { config } from "./config";
import { apiRouter } from "./routes";
import { discoveryRouter } from "./discovery";
import { buildPaymentMiddleware } from "./x402";
import { errorHandler } from "./http";
import { getProvider } from "./providers/index";

const app = express();
app.use(express.json());

// --- Free endpoints (no paywall) ---
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: getProvider().name,
    x402: config.x402Enabled,
    network: config.network,
  });
});
app.use(discoveryRouter);

// --- Paywall, then the paid API ---
app.use(buildPaymentMiddleware());
app.use("/api/v1", apiRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(
    `[humanbase] listening on http://localhost:${config.port} ` +
      `(provider=${getProvider().name}, x402=${config.x402Enabled}, network=${config.network})`,
  );
});
