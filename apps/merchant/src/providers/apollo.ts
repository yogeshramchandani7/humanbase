import type {
  Person,
  Organization,
  SearchResult,
  PeopleSearchRequest,
  OrganizationSearchRequest,
  PersonEnrichRequest,
  OrganizationEnrichRequest,
} from "@humanbase/shared";
import type { DataProvider } from "./types";

const BASE_URL = "https://api.apollo.io/api/v1";

/** Apollo issues separate API keys for the Search and Enrichment products. */
export interface ApolloKeys {
  search: string;
  enrich: string;
}

/** Proxies the real Apollo API and normalizes responses into our stable schema. */
export class ApolloProvider implements DataProvider {
  readonly name = "apollo" as const;

  constructor(private readonly keys: ApolloKeys) {}

  private async request<T>(
    path: string,
    init: {
      method: "GET" | "POST";
      key: keyof ApolloKeys;
      body?: unknown;
      query?: Record<string, string>;
    },
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    const res = await fetch(url, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        accept: "application/json",
        "x-api-key": this.keys[init.key],
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApolloError(res.status, text || res.statusText);
    }
    return res.json() as Promise<T>;
  }

  async searchPeople(req: PeopleSearchRequest): Promise<SearchResult<Person>> {
    // mixed_people/api_search is the credit-free, API-optimized search variant.
    const data = await this.request<ApolloPeopleSearchResponse>(
      "/mixed_people/api_search",
      {
        method: "POST",
        key: "search",
        body: {
          person_titles: req.person_titles,
          person_seniorities: req.person_seniorities,
          person_locations: req.person_locations,
          organization_locations: req.organization_locations,
          organization_num_employees_ranges: req.organization_num_employees_ranges,
          q_organization_domains_list: req.q_organization_domains,
          q_keywords: req.q_keywords,
          page: req.page,
          per_page: req.per_page,
        },
      },
    );
    return {
      results: (data.people ?? []).map(normalizePerson),
      pagination: normalizePagination(data.pagination, req.page, req.per_page),
      provider: "apollo",
    };
  }

  async searchOrganizations(
    req: OrganizationSearchRequest,
  ): Promise<SearchResult<Organization>> {
    const data = await this.request<ApolloOrgSearchResponse>(
      "/mixed_companies/search",
      {
        method: "POST",
        key: "search",
        body: {
          q_organization_name: req.q_organization_name,
          organization_locations: req.organization_locations,
          organization_num_employees_ranges: req.organization_num_employees_ranges,
          q_keywords: req.q_keywords,
          page: req.page,
          per_page: req.per_page,
        },
      },
    );
    return {
      results: (data.organizations ?? []).map(normalizeOrganization),
      pagination: normalizePagination(data.pagination, req.page, req.per_page),
      provider: "apollo",
    };
  }

  async enrichPerson(req: PersonEnrichRequest): Promise<Person | null> {
    const data = await this.request<{ person: ApolloPerson | null }>("/people/match", {
      method: "POST",
      key: "enrich",
      query: revealFlags(req),
      body: {
        id: req.id,
        first_name: req.first_name,
        last_name: req.last_name,
        name: req.name,
        email: req.email,
        organization_name: req.organization_name,
        domain: req.domain,
        linkedin_url: req.linkedin_url,
      },
    });
    return data.person ? normalizePerson(data.person) : null;
  }

  async enrichPeople(reqs: PersonEnrichRequest[]): Promise<(Person | null)[]> {
    const reveal = reqs[0] ?? {};
    const data = await this.request<{ matches: (ApolloPerson | null)[] }>(
      "/people/bulk_match",
      {
        method: "POST",
        key: "enrich",
        query: revealFlags(reveal),
        body: {
          details: reqs.map((r) => ({
            id: r.id,
            first_name: r.first_name,
            last_name: r.last_name,
            name: r.name,
            email: r.email,
            organization_name: r.organization_name,
            domain: r.domain,
            linkedin_url: r.linkedin_url,
          })),
        },
      },
    );
    return (data.matches ?? []).map((m) => (m ? normalizePerson(m) : null));
  }

  async enrichOrganization(
    req: OrganizationEnrichRequest,
  ): Promise<Organization | null> {
    const data = await this.request<{ organization: ApolloOrganization | null }>(
      "/organizations/enrich",
      { method: "GET", key: "enrich", query: { domain: req.domain } },
    );
    return data.organization ? normalizeOrganization(data.organization) : null;
  }
}

export class ApolloError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Apollo API ${status}: ${message}`);
    this.name = "ApolloError";
  }
}

function revealFlags(req: PersonEnrichRequest): Record<string, string> {
  const q: Record<string, string> = {};
  if (req.reveal_personal_emails) q.reveal_personal_emails = "true";
  if (req.reveal_phone_number) q.reveal_phone_number = "true";
  return q;
}

// ---------------------------------------------------------------------------
// Normalizers: Apollo raw shapes -> our stable schema
// ---------------------------------------------------------------------------

function normalizePerson(p: ApolloPerson): Person {
  const org = p.organization ?? null;
  const phone =
    p.phone_numbers?.find((n) => n.raw_number)?.raw_number ??
    p.organization?.phone ??
    null;
  return {
    id: String(p.id),
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    name: p.name ?? null,
    title: p.title ?? null,
    headline: p.headline ?? null,
    seniority: p.seniority ?? null,
    departments: p.departments ?? [],
    email: p.email ?? null,
    email_status: p.email_status ?? null,
    phone,
    linkedin_url: p.linkedin_url ?? null,
    photo_url: p.photo_url ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    organization: org
      ? {
          id: org.id ? String(org.id) : null,
          name: org.name ?? null,
          domain: org.primary_domain ?? org.website_url ?? null,
          website_url: org.website_url ?? null,
        }
      : null,
    source: "apollo",
  };
}

function normalizeOrganization(o: ApolloOrganization): Organization {
  return {
    id: String(o.id),
    name: o.name ?? null,
    domain: o.primary_domain ?? o.website_url ?? null,
    website_url: o.website_url ?? null,
    industry: o.industry ?? null,
    employee_count: o.estimated_num_employees ?? null,
    estimated_annual_revenue: o.annual_revenue_printed ?? null,
    founded_year: o.founded_year ?? null,
    phone: o.phone ?? o.primary_phone?.number ?? null,
    linkedin_url: o.linkedin_url ?? null,
    logo_url: o.logo_url ?? null,
    city: o.city ?? null,
    state: o.state ?? null,
    country: o.country ?? null,
    source: "apollo",
  };
}

function normalizePagination(
  p: ApolloPagination | undefined,
  page: number,
  per_page: number,
) {
  return {
    page: p?.page ?? page,
    per_page: p?.per_page ?? per_page,
    total_entries: p?.total_entries ?? 0,
    total_pages: p?.total_pages ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Minimal raw Apollo response typings (only the fields we read)
// ---------------------------------------------------------------------------

interface ApolloPagination {
  page?: number;
  per_page?: number;
  total_entries?: number;
  total_pages?: number;
}
interface ApolloOrganization {
  id: string | number;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  annual_revenue_printed?: string;
  founded_year?: number;
  phone?: string;
  primary_phone?: { number?: string };
  linkedin_url?: string;
  logo_url?: string;
  city?: string;
  state?: string;
  country?: string;
}
interface ApolloPerson {
  id: string | number;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  seniority?: string;
  departments?: string[];
  email?: string;
  email_status?: string;
  phone_numbers?: { raw_number?: string }[];
  linkedin_url?: string;
  photo_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloOrganization & { phone?: string };
}
interface ApolloPeopleSearchResponse {
  people?: ApolloPerson[];
  pagination?: ApolloPagination;
}
interface ApolloOrgSearchResponse {
  organizations?: ApolloOrganization[];
  pagination?: ApolloPagination;
}
