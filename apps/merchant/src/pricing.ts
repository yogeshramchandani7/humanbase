/**
 * The product catalog: one entry per paid endpoint. This is the single source of
 * truth for both the x402 paywall (src/x402.ts) and the discovery manifest
 * (src/discovery.ts), so price and metadata can never drift between them.
 *
 * Prices mirror Apollo's own credit ladder: search is cheap (Apollo charges no
 * credits for api_search), enrichment costs more (it returns verified emails),
 * and revealing phone numbers is the priciest.
 */
export interface EndpointSpec {
  method: "POST";
  path: string;
  price: `$${string}`;
  summary: string;
  description: string;
}

const PREFIX = "/api/v1";

export const ENDPOINTS: EndpointSpec[] = [
  {
    method: "POST",
    path: `${PREFIX}/people/search`,
    price: "$0.01",
    summary: "Search people",
    description:
      "Find people by title, seniority, location, company size, or keyword. Returns profile fields but no email/phone (use enrich for those).",
  },
  {
    method: "POST",
    path: `${PREFIX}/organizations/search`,
    price: "$0.03",
    summary: "Search organizations",
    description:
      "Find companies by name, location, headcount, or keyword. Returns firmographics (industry, employee count, revenue).",
  },
  {
    method: "POST",
    path: `${PREFIX}/people/enrich`,
    price: "$0.05",
    summary: "Enrich a person",
    description:
      "Resolve one person to a full profile including a verified work email. Pass reveal_phone_number to also return a phone.",
  },
  {
    method: "POST",
    path: `${PREFIX}/people/bulk_enrich`,
    price: "$0.40",
    summary: "Bulk enrich people",
    description: "Enrich up to 10 people in a single call. Flat-priced for the batch.",
  },
  {
    method: "POST",
    path: `${PREFIX}/organizations/enrich`,
    price: "$0.03",
    summary: "Enrich an organization",
    description: "Resolve a company domain to full firmographics.",
  },
];
