import "./env";
import { parseUnits } from "viem";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import type { Person } from "@humanbase/shared";
import { buildSigner } from "./signer";

const BASE = process.env.MERCHANT_BASE_URL ?? "http://localhost:3100";
// Spending cap per request, in USDC base units (6 decimals). Default: 1 USDC.
const MAX_PER_CALL = parseUnits(process.env.MAX_USDC_PER_CALL ?? "1", 6);

type Pay = ReturnType<typeof wrapFetchWithPayment>;

async function paidPost(pay: Pay, path: string, body: unknown) {
  const res = await pay(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }

  let settlement = "(open mode — no payment)";
  const header = res.headers.get("x-payment-response");
  if (header) {
    const d = decodeXPaymentResponse(header);
    settlement = d.success
      ? `paid ✓  tx ${d.transaction} on ${d.network} (payer ${d.payer})`
      : "payment reported failure";
  }
  return { data: (await res.json()) as any, settlement };
}

async function main() {
  const { account, mode, address } = await buildSigner();
  console.log(`[agent] signer=${mode}  address=${address}`);
  const pay: Pay = wrapFetchWithPayment(globalThis.fetch, account, MAX_PER_CALL);

  // 1) Discover what's for sale (free, no payment).
  const manifest = (await (await fetch(`${BASE}/.well-known/x402`)).json()) as {
    name: string;
    network: string;
    paymentRequired: boolean;
    endpoints: unknown[];
  };
  console.log(
    `[agent] merchant "${manifest.name}" on ${manifest.network} — ` +
      `${manifest.endpoints.length} endpoints, payment ${manifest.paymentRequired ? "ON" : "off"}`,
  );

  // 2) Search people (paid).
  const search = await paidPost(pay, "/api/v1/people/search", {
    person_titles: ["VP of Sales"],
    person_locations: ["United States"],
    per_page: 3,
  });
  const people = search.data.results as Person[];
  console.log(`\n[agent] people/search → ${people.length} results | ${search.settlement}`);
  for (const p of people) {
    console.log(`   • ${p.name} — ${p.title} @ ${p.organization?.name}`);
  }

  // 3) Enrich the top result to reveal contact info (paid, pricier).
  const top = people[0];
  const enrich = await paidPost(pay, "/api/v1/people/enrich", {
    name: top.name,
    domain: top.organization?.domain,
    reveal_phone_number: true,
  });
  const person = enrich.data.person as Person;
  console.log(`\n[agent] people/enrich → ${person.name} | ${enrich.settlement}`);
  console.log(`   email: ${person.email}`);
  console.log(`   phone: ${person.phone}`);

  console.log("\n[agent] done.");
}

main().catch((err) => {
  console.error("[agent] failed:", err);
  process.exit(1);
});
