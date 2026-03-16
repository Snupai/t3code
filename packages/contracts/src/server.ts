import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ProviderKind } from "./orchestration";
import { ProviderStartOptions } from "./provider";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

export const ServerProviderCatalogModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type ServerProviderCatalogModel = typeof ServerProviderCatalogModel.Type;

export const ServerProviderCatalogModelSource = Schema.Literals(["cli", "custom-only", "static"]);
export type ServerProviderCatalogModelSource = typeof ServerProviderCatalogModelSource.Type;

export const ServerProviderCatalogCapabilities = Schema.Struct({
  approvalRequired: Schema.Boolean,
  conversationRollback: Schema.Boolean,
  sessionModelSwitch: Schema.Literals(["in-session", "restart-session", "unsupported"]),
});
export type ServerProviderCatalogCapabilities = typeof ServerProviderCatalogCapabilities.Type;

export const ServerProviderCatalog = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderCatalogModel),
  modelSource: ServerProviderCatalogModelSource,
  capabilities: ServerProviderCatalogCapabilities,
});
export type ServerProviderCatalog = typeof ServerProviderCatalog.Type;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);
const ServerProviderCatalogs = Schema.Array(ServerProviderCatalog);

export const ServerInspectProvidersInput = Schema.Struct({
  providerOptions: Schema.optional(ProviderStartOptions),
  includeModels: Schema.optional(Schema.Boolean),
});
export type ServerInspectProvidersInput = typeof ServerInspectProvidersInput.Type;

export const ServerInspectProvidersResult = Schema.Struct({
  providers: ServerProviderCatalogs,
});
export type ServerInspectProvidersResult = typeof ServerInspectProvidersResult.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
