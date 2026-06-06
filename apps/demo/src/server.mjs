// humanbase x402r escrow — hackathon demo server.
//
// Strategy (see plan): the MERCHANT HTTP enrich is called LIVE (real data on a hit, real 404 on a
// miss), with a graceful fallback to a captured fixture if the merchant is down. The on-chain
// ESCROW artifacts (payment / settle / refund tx hashes + the zkTLS proof) are REPLAYED from
// fixtures — that is the slow/risky part and is never run live on stage.
import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO_ROOT = join(ROOT, "..", "..");

const PORT = Number(process.env.DEMO_PORT ?? 4000);
const MERCHANT_URL = process.env.MERCHANT_URL ?? "http://localhost:3100/api/v1/people/enrich";
const ENRICH_TIMEOUT_MS = Number(process.env.ENRICH_TIMEOUT_MS ?? 8000);

// The two demo requests. "found" exists in Apollo; "notfound" is a deliberately nonexistent person.
const QUERIES = {
  found: { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
  notfound: { first_name: "Zxqv", last_name: "Nonexistentsky", domain: "no-such-company-zzz123.example" },
};

const loadFixture = async (name) => JSON.parse(await readFile(join(ROOT, "fixtures", name), "utf8"));

/** Call the live merchant enrich; resolve to {live, status, person, error}. Never throws. */
async function liveEnrich(query) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ENRICH_TIMEOUT_MS);
  try {
    const r = await fetch(MERCHANT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
      signal: ctrl.signal,
    });
    if (r.status === 404) return { live: true, status: 404, person: null };
    if (r.status === 200) {
      const body = await r.json();
      return { live: true, status: 200, person: body.person ?? null, provenance: body.provenance ?? null };
    }
    // 402 (paywall on) or any other status → treat as "couldn't reach openly" → fallback.
    return { live: false, status: r.status, person: null, error: `merchant returned ${r.status}` };
  } catch (e) {
    return { live: false, status: 0, person: null, error: e.name === "AbortError" ? "timeout" : e.message };
  }
}

const app = express();
app.use(express.static(join(ROOT, "public")));

app.get("/api/run/:case", async (req, res) => {
  const c = req.params.case === "notfound" ? "notfound" : "found";
  const escrow = await loadFixture(`escrow-${c}.json`);
  const query = QUERIES[c];

  const enr = await liveEnrich(query);

  // We "reached" the merchant if it answered (200 with data, or 404). Apollo enrich never truly
  // 404s for a bogus query — it returns a hollow shell (name echoed, but no email/org). A record
  // with no verified contact data can't satisfy the zkTLS "good data" predicate → no proof → refund.
  const reached = enr.status === 200 || enr.status === 404;
  const hasContact = !!(enr.person && enr.person.email);
  let person = null;
  let liveData = false;
  if (c === "found") {
    if (enr.status === 200 && hasContact) { person = enr.person; liveData = true; }
    else { person = escrow.fallbackPerson; liveData = false; } // graceful fallback if merchant down/empty
  } else {
    // miss = a real 404, or a hollow match with no contact data
    liveData = reached && (enr.status === 404 || !hasContact);
    person = null;
  }

  res.json({
    case: c,
    query,
    status: escrow.status,            // SETTLED | REFUNDED
    amountUsdc: escrow.amountUsdc,
    merchant: { url: MERCHANT_URL, live: liveData, reached, httpStatus: enr.status, note: enr.error ?? null },
    person,
    proof: escrow.proof,              // replayed zkTLS proof artifact (null for notfound)
    hashes: escrow.hashes,            // { payment, settle? , refund? }
    explorer: "https://sepolia.basescan.org/tx/",
    explorerLinkable: escrow.explorerLinkable ?? false, // true only when hashes are from real testnet
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, merchant: MERCHANT_URL }));

/** Ensure the merchant is up with the paywall OFF (so the demo's enrich call is live). No-op if
 *  it's already responding; otherwise spawn it. Set DEMO_NO_SPAWN=1 to manage the merchant yourself. */
async function ensureMerchant() {
  const origin = new URL(MERCHANT_URL).origin;
  try {
    const r = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) { console.log(`[demo] merchant already up at ${origin}`); return; }
  } catch { /* not up — spawn below */ }
  if (process.env.DEMO_NO_SPAWN) { console.log("[demo] merchant not up (DEMO_NO_SPAWN set; start it yourself)"); return; }
  const merchantPort = new URL(MERCHANT_URL).port || "3100";
  console.log(`[demo] starting merchant (paywall off) on :${merchantPort}…`);
  const m = spawn("npm", ["run", "start", "-w", "apps/merchant"], {
    cwd: REPO_ROOT,
    // PORT must be pinned: the demo may have inherited PORT (e.g. 4000) from its launcher, which
    // the merchant would otherwise bind and collide. Override it for the child explicitly.
    env: { ...process.env, PORT: merchantPort, X402_ENABLED: "false", ATTEST_ENABLED: "false", DATA_PROVIDER: "apollo" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  m.stdout.on("data", (b) => process.stdout.write(`[merchant] ${b}`));
  m.stderr.on("data", (b) => process.stderr.write(`[merchant] ${b}`));
  process.on("exit", () => m.kill());
}

app.listen(PORT, async () => {
  console.log(`[demo] http://localhost:${PORT}  (merchant: ${MERCHANT_URL})`);
  await ensureMerchant();
});
