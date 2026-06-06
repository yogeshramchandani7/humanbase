import type {
  Person,
  Organization,
  SearchResult,
  OrganizationSummary,
  PeopleSearchRequest,
  OrganizationSearchRequest,
  PersonEnrichRequest,
  OrganizationEnrichRequest,
} from "@humanbase/shared";
import type { DataProvider } from "./types";

/**
 * Deterministic faker. Output is seeded from the request, so the same query
 * returns the same people across calls — handy for demos and tests, and it lets
 * search results be re-enriched consistently.
 */

const FIRST = [
  "Ava", "Liam", "Noah", "Emma", "Olivia", "Sophia", "Jackson", "Lucas", "Mia",
  "Ethan", "Isabella", "Mason", "Aria", "Logan", "Riley", "Maya", "Ravi",
  "Priya", "Chen", "Sofia",
];
const LAST = [
  "Smith", "Johnson", "Patel", "Garcia", "Kim", "Nguyen", "Muller", "Rossi",
  "Silva", "Khan", "Cohen", "Okafor", "Andersson", "Tanaka", "Brown", "Lopez",
  "Wang", "Singh", "Ivanov", "Costa",
];
const COMPANIES: [string, string, string][] = [
  ["Acme Corp", "acme.com", "Software"],
  ["Globex", "globex.io", "Manufacturing"],
  ["Initech", "initech.com", "Information Technology"],
  ["Umbrella Health", "umbrella.co", "Healthcare"],
  ["Hooli", "hooli.com", "Internet"],
  ["Stark Industries", "stark.com", "Defense"],
  ["Wayne Enterprises", "wayne.com", "Conglomerate"],
  ["Cyberdyne", "cyberdyne.ai", "Artificial Intelligence"],
];
const TITLES = [
  "VP of Sales", "Head of Marketing", "Software Engineer", "Product Manager",
  "Chief Executive Officer", "Chief Technology Officer", "Account Executive",
  "Data Scientist",
];
const SENIORITIES = ["vp", "head", "entry", "manager", "c_suite", "c_suite", "senior", "senior"];
const DEPARTMENTS = [
  ["sales"], ["marketing"], ["engineering"], ["product"],
  ["executive"], ["engineering"], ["sales"], ["data"],
];
const CITIES: [string, string | null, string][] = [
  ["San Francisco", "California", "United States"],
  ["New York", "New York", "United States"],
  ["London", null, "United Kingdom"],
  ["Berlin", null, "Germany"],
  ["Bangalore", null, "India"],
  ["Toronto", "Ontario", "Canada"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function at<T>(arr: T[], n: number): T {
  // n can be negative (signed 32-bit shifts on large hashes) — wrap safely.
  const i = ((Math.trunc(n) % arr.length) + arr.length) % arr.length;
  return arr[i];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function makeOrg(
  seed: number,
  domainHint?: string,
): { id: string; name: string; domain: string; website_url: string; industry: string } {
  if (domainHint) {
    const name = domainHint.split(".")[0];
    return {
      id: `mock_org_${hash(domainHint)}`,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      domain: domainHint,
      website_url: `https://${domainHint}`,
      industry: "Software",
    };
  }
  const [name, domain, industry] = at(COMPANIES, seed);
  return {
    id: `mock_org_${hash(domain)}`,
    name,
    domain,
    website_url: `https://${domain}`,
    industry,
  };
}

function makePerson(
  seed: number,
  opts: {
    titles?: string[];
    locations?: string[];
    domains?: string[];
    reveal_email?: boolean;
    reveal_phone?: boolean;
    nameHint?: { first?: string; last?: string };
  },
): Person {
  const first = opts.nameHint?.first ?? at(FIRST, seed);
  const last = opts.nameHint?.last ?? at(LAST, seed >> 3);
  const title = opts.titles?.length ? at(opts.titles, seed) : at(TITLES, seed);
  const [city, state, country] = at(CITIES, seed >> 5);
  const org = makeOrg(seed >> 7, opts.domains?.length ? at(opts.domains, seed) : undefined);
  const id = `mock_person_${hash(`${first}${last}${org.domain}${seed}`)}`;

  return {
    id,
    first_name: first,
    last_name: last,
    name: `${first} ${last}`,
    title,
    headline: `${title} at ${org.name}`,
    seniority: at(SENIORITIES, seed),
    departments: at(DEPARTMENTS, seed),
    email: opts.reveal_email ? `${slug(first)}.${slug(last)}@${org.domain}` : null,
    email_status: opts.reveal_email ? "verified" : null,
    phone: opts.reveal_phone
      ? `+1${(2025550000 + (seed % 9999)).toString().padStart(10, "0")}`
      : null,
    linkedin_url: `https://www.linkedin.com/in/${slug(first)}-${slug(last)}-${seed % 1000}`,
    photo_url: null,
    city,
    state,
    country: opts.locations?.length ? at(opts.locations, seed) : country,
    organization: {
      id: org.id,
      name: org.name,
      domain: org.domain,
      website_url: org.website_url,
    },
    source: "mock",
  };
}

export class MockProvider implements DataProvider {
  readonly name = "mock" as const;

  async searchPeople(req: PeopleSearchRequest): Promise<SearchResult<Person>> {
    const base = hash(JSON.stringify(req));
    const results = Array.from({ length: req.per_page }, (_, i) =>
      makePerson(base + (req.page - 1) * req.per_page + i, {
        titles: req.person_titles,
        locations: req.person_locations,
        domains: req.q_organization_domains,
      }),
    );
    return {
      results,
      pagination: paginate(req.page, req.per_page),
      provider: "mock",
    };
  }

  async searchOrganizations(
    req: OrganizationSearchRequest,
  ): Promise<SearchResult<Organization>> {
    const base = hash(JSON.stringify(req));
    const results = Array.from({ length: req.per_page }, (_, i) => {
      const seed = base + (req.page - 1) * req.per_page + i;
      const o = makeOrg(seed);
      const [city, state, country] = at(CITIES, seed >> 5);
      return {
        id: o.id,
        name: req.q_organization_name ?? o.name,
        domain: o.domain,
        website_url: o.website_url,
        industry: o.industry,
        employee_count: 50 + (seed % 9950),
        estimated_annual_revenue: `$${1 + (seed % 500)}M`,
        founded_year: 1980 + (seed % 44),
        phone: `+1${(2025550000 + (seed % 9999))}`,
        linkedin_url: `https://www.linkedin.com/company/${slug(o.name ?? "co")}`,
        logo_url: null,
        city,
        state,
        country,
        source: "mock" as const,
      } satisfies Organization;
    });
    return {
      results,
      pagination: paginate(req.page, req.per_page),
      provider: "mock",
    };
  }

  async enrichPerson(req: PersonEnrichRequest): Promise<Person | null> {
    const seed = hash(JSON.stringify(req));
    const domain =
      req.domain ??
      (req.email?.includes("@") ? req.email.split("@")[1] : undefined) ??
      (req.organization_name ? `${slug(req.organization_name)}.com` : undefined);
    let first = req.first_name;
    let last = req.last_name;
    if (!first && req.name) {
      const parts = req.name.trim().split(/\s+/);
      first = parts[0];
      last = parts.slice(1).join(" ") || undefined;
    }
    return makePerson(seed, {
      domains: domain ? [domain] : undefined,
      reveal_email: true, // enrichment always returns a work email
      reveal_phone: req.reveal_phone_number ?? false,
      nameHint: { first, last },
    });
  }

  async enrichPeople(reqs: PersonEnrichRequest[]): Promise<(Person | null)[]> {
    return Promise.all(reqs.map((r) => this.enrichPerson(r)));
  }

  async enrichOrganization(
    req: OrganizationEnrichRequest,
  ): Promise<Organization | null> {
    const seed = hash(req.domain);
    const o = makeOrg(seed, req.domain);
    const [city, state, country] = at(CITIES, seed >> 5);
    return {
      id: o.id,
      name: o.name,
      domain: o.domain,
      website_url: o.website_url,
      industry: o.industry,
      employee_count: 50 + (seed % 9950),
      estimated_annual_revenue: `$${1 + (seed % 500)}M`,
      founded_year: 1980 + (seed % 44),
      phone: `+1${(2025550000 + (seed % 9999))}`,
      linkedin_url: `https://www.linkedin.com/company/${slug(o.name ?? "co")}`,
      logo_url: null,
      city,
      state,
      country,
      source: "mock",
    };
  }
}

function paginate(page: number, per_page: number) {
  const total_entries = 1000;
  return {
    page,
    per_page,
    total_entries,
    total_pages: Math.ceil(total_entries / per_page),
  };
}
