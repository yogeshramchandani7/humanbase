import type {
  Person,
  Organization,
  SearchResult,
  PeopleSearchRequest,
  OrganizationSearchRequest,
  PersonEnrichRequest,
  OrganizationEnrichRequest,
  ProviderName,
} from "@humanbase/shared";

/**
 * The single seam between "where data comes from" and "what we sell".
 * ApolloProvider proxies the real API; MockProvider fakes it. Swap via env.
 */
export interface DataProvider {
  readonly name: ProviderName;

  searchPeople(req: PeopleSearchRequest): Promise<SearchResult<Person>>;
  searchOrganizations(
    req: OrganizationSearchRequest,
  ): Promise<SearchResult<Organization>>;

  enrichPerson(req: PersonEnrichRequest): Promise<Person | null>;
  enrichPeople(reqs: PersonEnrichRequest[]): Promise<(Person | null)[]>;
  enrichOrganization(req: OrganizationEnrichRequest): Promise<Organization | null>;
}
