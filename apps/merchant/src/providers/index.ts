import type { DataProvider } from "./types";
import { MockProvider } from "./mock";
import { ApolloProvider } from "./apollo";
import { config } from "../config";

let cached: DataProvider | undefined;

/**
 * Selects the active provider from env, caching the instance.
 * - DATA_PROVIDER=apollo + an Apollo key -> real Apollo proxy
 * - otherwise (or key missing) -> mock DB, so dev never needs Apollo credits.
 */
export function getProvider(): DataProvider {
  if (cached) return cached;

  if (config.dataProvider === "apollo") {
    const { apolloSearchKey, apolloEnrichKey } = config;
    if (apolloSearchKey && apolloEnrichKey) {
      cached = new ApolloProvider({ search: apolloSearchKey, enrich: apolloEnrichKey });
    } else {
      console.warn(
        "[providers] DATA_PROVIDER=apollo but no Apollo key set — falling back to mock.",
      );
      cached = new MockProvider();
    }
  } else {
    cached = new MockProvider();
  }

  return cached;
}

export type { DataProvider } from "./types";
