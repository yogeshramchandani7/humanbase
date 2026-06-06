import { z } from "zod";

/**
 * Stable, provider-agnostic schema.
 *
 * Both the Apollo proxy and the mock DB normalize INTO these shapes, so an agent
 * always sees the same fields regardless of where the data came from. This is the
 * contract the x402 endpoints sell.
 */

export const ProviderName = z.enum(["apollo", "mock"]);
export type ProviderName = z.infer<typeof ProviderName>;

// ---------------------------------------------------------------------------
// Normalized entities
// ---------------------------------------------------------------------------

export const OrganizationSummary = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  website_url: z.string().nullable(),
});
export type OrganizationSummary = z.infer<typeof OrganizationSummary>;

export const Person = z.object({
  id: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  headline: z.string().nullable(),
  seniority: z.string().nullable(),
  departments: z.array(z.string()).default([]),
  /** Contact fields are null until enriched (and paid for). */
  email: z.string().nullable(),
  email_status: z.string().nullable(),
  phone: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  photo_url: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  organization: OrganizationSummary.nullable(),
  source: ProviderName,
});
export type Person = z.infer<typeof Person>;

export const Organization = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  website_url: z.string().nullable(),
  industry: z.string().nullable(),
  employee_count: z.number().nullable(),
  estimated_annual_revenue: z.string().nullable(),
  founded_year: z.number().nullable(),
  phone: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  logo_url: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  source: ProviderName,
});
export type Organization = z.infer<typeof Organization>;

export interface SearchResult<T> {
  results: T[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
  provider: ProviderName;
}

// ---------------------------------------------------------------------------
// Request schemas (mirror Apollo's filter vocabulary)
// ---------------------------------------------------------------------------

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(10),
};

export const PeopleSearchRequest = z.object({
  person_titles: z.array(z.string()).optional(),
  person_seniorities: z.array(z.string()).optional(),
  person_locations: z.array(z.string()).optional(),
  organization_locations: z.array(z.string()).optional(),
  organization_num_employees_ranges: z.array(z.string()).optional(),
  q_organization_domains: z.array(z.string()).optional(),
  q_keywords: z.string().optional(),
  ...pageFields,
});
export type PeopleSearchRequest = z.infer<typeof PeopleSearchRequest>;

export const OrganizationSearchRequest = z.object({
  q_organization_name: z.string().optional(),
  organization_locations: z.array(z.string()).optional(),
  organization_num_employees_ranges: z.array(z.string()).optional(),
  q_keywords: z.string().optional(),
  ...pageFields,
});
export type OrganizationSearchRequest = z.infer<typeof OrganizationSearchRequest>;

export const PersonEnrichRequest = z.object({
  id: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  organization_name: z.string().optional(),
  domain: z.string().optional(),
  linkedin_url: z.string().optional(),
  reveal_personal_emails: z.boolean().optional(),
  reveal_phone_number: z.boolean().optional(),
});
export type PersonEnrichRequest = z.infer<typeof PersonEnrichRequest>;

export const BulkPeopleEnrichRequest = z.object({
  details: z.array(PersonEnrichRequest).min(1).max(10),
  reveal_personal_emails: z.boolean().optional(),
  reveal_phone_number: z.boolean().optional(),
});
export type BulkPeopleEnrichRequest = z.infer<typeof BulkPeopleEnrichRequest>;

export const OrganizationEnrichRequest = z.object({
  domain: z.string(),
});
export type OrganizationEnrichRequest = z.infer<typeof OrganizationEnrichRequest>;
