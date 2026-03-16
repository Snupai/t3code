import { queryOptions } from "@tanstack/react-query";
import { type ServerInspectProvidersInput } from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  inspectProviders: (input: ServerInspectProvidersInput) =>
    ["server", "inspectProviders", input] as const,
};

export function serverConfigQueryOptions(options?: { enabled?: boolean }) {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}

export function serverInspectProvidersQueryOptions(
  input: ServerInspectProvidersInput,
  options?: { enabled?: boolean },
) {
  return queryOptions({
    queryKey: serverQueryKeys.inspectProviders(input),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.inspectProviders(input);
    },
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}
