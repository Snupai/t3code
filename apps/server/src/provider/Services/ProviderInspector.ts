import type { ServerInspectProvidersInput, ServerProviderCatalog } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderInspectorShape {
  readonly inspect: (
    input?: ServerInspectProvidersInput,
  ) => Effect.Effect<ReadonlyArray<ServerProviderCatalog>>;
}

export class ProviderInspector extends ServiceMap.Service<
  ProviderInspector,
  ProviderInspectorShape
>()("t3/provider/Services/ProviderInspector") {}
