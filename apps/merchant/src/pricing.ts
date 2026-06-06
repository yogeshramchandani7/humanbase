/**
 * The product catalog: one entry per paid endpoint. This is the single source of
 * truth for both the x402 paywall (src/x402.ts) and the discovery manifest
 * (src/discovery.ts), so price and metadata can never drift between them.
 *
 * Prices mirror Apollo's own credit ladder: search is cheap (Apollo charges no
 * credits for api_search), enrichment costs more (it returns verified emails),
 * and revealing phone numbers is the priciest.
 *
 * Each endpoint also carries `discovery` metadata. That feeds the x402 Bazaar
 * discovery extension (so humanbase auto-lists on agentic.market and other
 * Bazaar viewers once a payment settles through the CDP facilitator) AND the
 * /.well-known/x402 manifest. `input`/`inputSchema` describe the request body
 * (JSON), and `output.example`/`output.schema` describe the response — both
 * derived from the @humanbase/shared entities and the actual route responses.
 */
export interface DiscoveryMeta {
  /** Short, sanitized tags for catalog filtering (≤ a few, lowercase). */
  tags: string[];
  /** A representative request body. */
  input: Record<string, unknown>;
  /** JSON Schema of the request body. */
  inputSchema: Record<string, unknown>;
  output: {
    /** A representative response body. */
    example: unknown;
    /** JSON Schema of the response body. */
    schema?: Record<string, unknown>;
  };
}

export interface EndpointSpec {
  method: "POST";
  path: string;
  price: `$${string}`;
  summary: string;
  description: string;
  discovery: DiscoveryMeta;
}

const PREFIX = "/api/v1";

// ---------------------------------------------------------------------------
// Reusable JSON-Schema fragments (mirror @humanbase/shared entities)
// ---------------------------------------------------------------------------

const strArray = { type: "array", items: { type: "string" } } as const;
const pageProps = {
  page: { type: "integer", minimum: 1, default: 1 },
  per_page: { type: "integer", minimum: 1, maximum: 100, default: 10 },
} as const;

const personSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    headline: { type: ["string", "null"] },
    seniority: { type: ["string", "null"] },
    departments: { type: "array", items: { type: "string" } },
    email: { type: ["string", "null"], description: "null until enriched" },
    email_status: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    linkedin_url: { type: ["string", "null"] },
    photo_url: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    organization: { type: ["object", "null"] },
    source: { type: "string", enum: ["apollo", "mock"] },
  },
} as const;

const organizationSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: ["string", "null"] },
    domain: { type: ["string", "null"] },
    website_url: { type: ["string", "null"] },
    industry: { type: ["string", "null"] },
    employee_count: { type: ["number", "null"] },
    estimated_annual_revenue: { type: ["string", "null"] },
    founded_year: { type: ["number", "null"] },
    phone: { type: ["string", "null"] },
    linkedin_url: { type: ["string", "null"] },
    logo_url: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    source: { type: "string", enum: ["apollo", "mock"] },
  },
} as const;

const paginationSchema = {
  type: "object",
  properties: {
    page: { type: "integer" },
    per_page: { type: "integer" },
    total_entries: { type: "integer" },
    total_pages: { type: "integer" },
  },
} as const;

const samplePerson = {
  id: "5f1b...c2",
  first_name: "Tim",
  last_name: "Zheng",
  name: "Tim Zheng",
  title: "Founder & CEO",
  headline: "Founder & CEO at Apollo.io",
  seniority: "founder",
  departments: ["executive"],
  email: null,
  email_status: null,
  phone: null,
  linkedin_url: "https://linkedin.com/in/tim-zheng",
  photo_url: null,
  city: "San Francisco",
  state: "California",
  country: "United States",
  organization: {
    id: "5a9...e1",
    name: "Apollo.io",
    domain: "apollo.io",
    website_url: "https://apollo.io",
  },
  source: "apollo",
};

const sampleOrganization = {
  id: "5a9...e1",
  name: "Apollo.io",
  domain: "apollo.io",
  website_url: "https://apollo.io",
  industry: "information technology & services",
  employee_count: 1200,
  estimated_annual_revenue: "100M-250M",
  founded_year: 2015,
  phone: null,
  linkedin_url: "https://linkedin.com/company/apolloio",
  logo_url: null,
  city: "San Francisco",
  state: "California",
  country: "United States",
  source: "apollo",
};

const searchResultSchema = (itemSchema: Record<string, unknown>) =>
  ({
    type: "object",
    properties: {
      results: { type: "array", items: itemSchema },
      pagination: paginationSchema,
      provider: { type: "string", enum: ["apollo", "mock"] },
    },
    required: ["results", "pagination", "provider"],
  }) as Record<string, unknown>;

export const ENDPOINTS: EndpointSpec[] = [
  {
    method: "POST",
    path: `${PREFIX}/people/search`,
    price: "$0.01",
    summary: "Search people",
    description:
      "Find people by title, seniority, location, company size, or keyword. Returns profile fields but no email/phone (use enrich for those).",
    discovery: {
      tags: ["people", "search", "b2b", "prospecting"],
      input: { person_titles: ["VP of Sales"], person_locations: ["San Francisco, US"], per_page: 5 },
      inputSchema: {
        type: "object",
        properties: {
          person_titles: strArray,
          person_seniorities: strArray,
          person_locations: strArray,
          organization_locations: strArray,
          organization_num_employees_ranges: strArray,
          q_organization_domains: strArray,
          q_keywords: { type: "string" },
          ...pageProps,
        },
      },
      output: {
        example: {
          results: [samplePerson],
          pagination: { page: 1, per_page: 5, total_entries: 124, total_pages: 25 },
          provider: "apollo",
        },
        schema: searchResultSchema(personSchema as Record<string, unknown>),
      },
    },
  },
  {
    method: "POST",
    path: `${PREFIX}/organizations/search`,
    price: "$0.03",
    summary: "Search organizations",
    description:
      "Find companies by name, location, headcount, or keyword. Returns firmographics (industry, employee count, revenue).",
    discovery: {
      tags: ["companies", "search", "b2b", "firmographics"],
      input: { q_organization_name: "Apollo", organization_locations: ["United States"], per_page: 5 },
      inputSchema: {
        type: "object",
        properties: {
          q_organization_name: { type: "string" },
          organization_locations: strArray,
          organization_num_employees_ranges: strArray,
          q_keywords: { type: "string" },
          ...pageProps,
        },
      },
      output: {
        example: {
          results: [sampleOrganization],
          pagination: { page: 1, per_page: 5, total_entries: 42, total_pages: 9 },
          provider: "apollo",
        },
        schema: searchResultSchema(organizationSchema as Record<string, unknown>),
      },
    },
  },
  {
    method: "POST",
    path: `${PREFIX}/people/enrich`,
    price: "$0.05",
    summary: "Enrich a person",
    description:
      "Resolve one person to a full profile including a verified work email. Pass reveal_phone_number to also return a phone.",
    discovery: {
      tags: ["people", "enrich", "email", "contact"],
      input: { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          organization_name: { type: "string" },
          domain: { type: "string" },
          linkedin_url: { type: "string" },
          reveal_personal_emails: { type: "boolean" },
          reveal_phone_number: { type: "boolean" },
        },
      },
      output: {
        example: { person: { ...samplePerson, email: "tim@apollo.io", email_status: "verified" } },
        schema: {
          type: "object",
          properties: { person: personSchema },
          required: ["person"],
        },
      },
    },
  },
  {
    method: "POST",
    path: `${PREFIX}/people/bulk_enrich`,
    price: "$0.40",
    summary: "Bulk enrich people",
    description: "Enrich up to 10 people in a single call. Flat-priced for the batch.",
    discovery: {
      tags: ["people", "enrich", "bulk", "email"],
      input: {
        details: [
          { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
          { name: "Vrajang Parikh", domain: "microsoft.com" },
        ],
      },
      inputSchema: {
        type: "object",
        properties: {
          details: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                organization_name: { type: "string" },
                domain: { type: "string" },
                linkedin_url: { type: "string" },
              },
            },
          },
          reveal_personal_emails: { type: "boolean" },
          reveal_phone_number: { type: "boolean" },
        },
        required: ["details"],
      },
      output: {
        example: {
          matches: [{ ...samplePerson, email: "tim@apollo.io", email_status: "verified" }, null],
        },
        schema: {
          type: "object",
          properties: {
            matches: { type: "array", items: { anyOf: [personSchema, { type: "null" }] } },
          },
          required: ["matches"],
        },
      },
    },
  },
  {
    method: "POST",
    path: `${PREFIX}/organizations/enrich`,
    price: "$0.03",
    summary: "Enrich an organization",
    description: "Resolve a company domain to full firmographics.",
    discovery: {
      tags: ["companies", "enrich", "firmographics"],
      input: { domain: "apollo.io" },
      inputSchema: {
        type: "object",
        properties: { domain: { type: "string" } },
        required: ["domain"],
      },
      output: {
        example: { organization: sampleOrganization },
        schema: {
          type: "object",
          properties: { organization: organizationSchema },
          required: ["organization"],
        },
      },
    },
  },
];
