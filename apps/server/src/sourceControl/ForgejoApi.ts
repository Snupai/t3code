import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  TrimmedNonEmptyString,
  TrimmedString,
  type SourceControlProviderAuth,
  type SourceControlProviderInfo,
  type SourceControlRepositoryCloneUrls,
  type SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import {
  detectSourceControlProviderFromRemoteUrl,
  isSshRemoteUrl,
  remoteUrlMatchesSourceControlHost,
} from "@t3tools/shared/sourceControl";

import {
  ForgejoPullRequestListSchema,
  ForgejoPullRequestSchema,
  normalizeForgejoPullRequestRecord,
  type NormalizedForgejoPullRequestRecord,
} from "./forgejoPullRequests.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import { retryAtFromHeader } from "./SourceControlRateLimit.ts";
import { FORGEJO_ACCESS_TOKEN_SECRET_NAME, readForgejoProcessEnv } from "./forgejoCredentials.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

/** A response body past this is cut short, so one huge diff cannot exhaust the server. */
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export const FORGEJO_INSTALL_HINT =
  "Enter your Forgejo origin and access token in Settings → Source Control, or set T3CODE_FORGEJO_URL and T3CODE_FORGEJO_TOKEN on the server.";

const ForgejoApiOperation = Schema.Literals([
  "resolveRepository",
  "getRepository",
  "getPullRequest",
  "listPullRequests",
  "createRepository",
  "createPullRequest",
  "probeAuth",
  "checkoutPullRequest",
  "request",
]);
type ForgejoApiOperation = typeof ForgejoApiOperation.Type;

export class ForgejoRepositoryLocatorError extends Schema.TaggedErrorClass<ForgejoRepositoryLocatorError>()(
  "ForgejoRepositoryLocatorError",
  {
    repository: Schema.String,
  },
) {
  get detail(): string {
    return "Forgejo repositories must be specified as owner/repository.";
  }

  override get message(): string {
    return `Forgejo API failed in createRepository: ${this.detail}`;
  }
}

export class ForgejoConfigError extends Schema.TaggedErrorClass<ForgejoConfigError>()(
  "ForgejoConfigError",
  {
    operation: ForgejoApiOperation,
  },
) {
  get detail(): string {
    return FORGEJO_INSTALL_HINT;
  }

  override get message(): string {
    return `Forgejo API failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoRequestError extends Schema.TaggedErrorClass<ForgejoRequestError>()(
  "ForgejoRequestError",
  {
    operation: ForgejoApiOperation,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Failed to send the Forgejo request.";
  }

  override get message(): string {
    return `Forgejo API failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoResponseError extends Schema.TaggedErrorClass<ForgejoResponseError>()(
  "ForgejoResponseError",
  {
    operation: ForgejoApiOperation,
    status: Schema.Int,
    responseBodyLength: NonNegativeInt,
    retryAt: Schema.optional(Schema.Number),
  },
) {
  get detail(): string {
    return `Forgejo returned HTTP ${this.status}.`;
  }

  override get message(): string {
    return `Forgejo API failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoResponseBodyReadError extends Schema.TaggedErrorClass<ForgejoResponseBodyReadError>()(
  "ForgejoResponseBodyReadError",
  {
    operation: ForgejoApiOperation,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Forgejo returned HTTP ${this.status}.`;
  }

  override get message(): string {
    return `Forgejo API failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoResponseDecodeError extends Schema.TaggedErrorClass<ForgejoResponseDecodeError>()(
  "ForgejoResponseDecodeError",
  {
    operation: ForgejoApiOperation,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Forgejo returned invalid JSON for the requested resource.";
  }

  override get message(): string {
    return `Forgejo API failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoRepositoryVcsResolveError extends Schema.TaggedErrorClass<ForgejoRepositoryVcsResolveError>()(
  "ForgejoRepositoryVcsResolveError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to resolve VCS repository for ${this.cwd}.`;
  }

  override get message(): string {
    return `Forgejo API failed in resolveRepository: ${this.detail}`;
  }
}

export class ForgejoRepositoryRemotesListError extends Schema.TaggedErrorClass<ForgejoRepositoryRemotesListError>()(
  "ForgejoRepositoryRemotesListError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to list remotes for ${this.cwd}.`;
  }

  override get message(): string {
    return `Forgejo API failed in resolveRepository: ${this.detail}`;
  }
}

export class ForgejoRepositoryRemoteNotFoundError extends Schema.TaggedErrorClass<ForgejoRepositoryRemoteNotFoundError>()(
  "ForgejoRepositoryRemoteNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  get detail(): string {
    return `No Forgejo repository remote was detected for ${this.cwd}.`;
  }

  override get message(): string {
    return `Forgejo API failed in resolveRepository: ${this.detail}`;
  }
}

export class ForgejoPullRequestBodyReadError extends Schema.TaggedErrorClass<ForgejoPullRequestBodyReadError>()(
  "ForgejoPullRequestBodyReadError",
  {
    cwd: Schema.String,
    bodyFile: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to read pull request body file ${this.bodyFile}.`;
  }

  override get message(): string {
    return `Forgejo API failed in createPullRequest: ${this.detail}`;
  }
}

export class ForgejoCheckoutError extends Schema.TaggedErrorClass<ForgejoCheckoutError>()(
  "ForgejoCheckoutError",
  {
    cwd: Schema.String,
    reference: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Failed to check out the Forgejo pull request.";
  }

  override get message(): string {
    return `Forgejo API failed in checkoutPullRequest: ${this.detail}`;
  }
}

export class ForgejoUntrustedUrlError extends Schema.TaggedErrorClass<ForgejoUntrustedUrlError>()(
  "ForgejoUntrustedUrlError",
  {
    host: Schema.String,
  },
) {
  get detail(): string {
    return `The response pointed at ${this.host}, outside the configured Forgejo.`;
  }

  override get message(): string {
    return `Forgejo API failed in request: ${this.detail}`;
  }
}

export const ForgejoApiError = Schema.Union([
  ForgejoUntrustedUrlError,
  ForgejoRepositoryLocatorError,
  ForgejoConfigError,
  ForgejoRequestError,
  ForgejoResponseError,
  ForgejoResponseBodyReadError,
  ForgejoResponseDecodeError,
  ForgejoRepositoryVcsResolveError,
  ForgejoRepositoryRemotesListError,
  ForgejoRepositoryRemoteNotFoundError,
  ForgejoPullRequestBodyReadError,
  ForgejoCheckoutError,
]);
export type ForgejoApiError = typeof ForgejoApiError.Type;
export const isForgejoApiError = Schema.is(ForgejoApiError);

const RawForgejoRepositorySchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  clone_url: Schema.optional(TrimmedNonEmptyString),
  ssh_url: Schema.optional(TrimmedNonEmptyString),
  html_url: Schema.optional(TrimmedNonEmptyString),
  default_branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const OptionalForgejoUserName = Schema.optional(Schema.NullOr(TrimmedString));

const ForgejoUserSchema = Schema.Struct({
  login: OptionalForgejoUserName,
  username: OptionalForgejoUserName,
  full_name: OptionalForgejoUserName,
});

export interface ForgejoRepositoryLocator {
  readonly owner: string;
  readonly repo: string;
}

export class ForgejoApi extends Context.Service<
  ForgejoApi,
  {
    readonly credentials: Effect.Effect<{
      readonly url: string | null;
      readonly token: string | null;
    }>;
    readonly probeAuth: Effect.Effect<SourceControlProviderAuth, never>;
    readonly request: (input: {
      readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      readonly url: string;
      readonly body?: string;
      readonly maxBytes?: number;
    }) => Effect.Effect<{ readonly body: string; readonly truncated: boolean }, ForgejoApiError>;
    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly state: "open" | "closed" | "merged" | "all";
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<NormalizedForgejoPullRequestRecord>, ForgejoApiError>;
    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
    }) => Effect.Effect<NormalizedForgejoPullRequestRecord, ForgejoApiError>;
    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, ForgejoApiError>;
    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, ForgejoApiError>;
    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly target?: SourceControlProvider.SourceControlRefSelector;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, ForgejoApiError>;
    readonly getDefaultBranch: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
    }) => Effect.Effect<string | null, ForgejoApiError>;
    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, ForgejoApiError>;
  }
>()("t3/sourceControl/ForgejoApi") {}

function nonEmpty(value: string | null | undefined): Option.Option<string> {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? Option.none() : Option.some(trimmed);
}

function firstNonEmptyName(
  ...values: ReadonlyArray<string | null | undefined>
): Option.Option<string> {
  for (const value of values) {
    const option = nonEmpty(value);
    if (Option.isSome(option)) return option;
  }
  return Option.none();
}

function configuredText(value: string | null | undefined): string | null {
  return Option.getOrNull(nonEmpty(value ?? undefined));
}

function normalizeChangeRequestId(reference: string): string {
  const trimmed = reference.trim().replace(/^#/, "");
  const urlMatch = /(?:pulls|pull-requests|pull)\/(\d+)(?:\D.*)?$/i.exec(trimmed);
  return urlMatch?.[1] ?? trimmed;
}

function sourceOwner(input: {
  readonly headSelector: string;
  readonly source?: SourceControlProvider.SourceControlRefSelector;
}): string | undefined {
  if (input.source?.owner) return input.source.owner;
  return SourceControlProvider.parseSourceControlOwnerRef(input.headSelector)?.owner;
}

function toForgejoState(state: "open" | "closed" | "merged" | "all"): string {
  switch (state) {
    case "open":
      return "open";
    case "closed":
    case "merged":
      return "closed";
    case "all":
      return "all";
  }
}

function parseForgejoRepositorySlug(value: string): ForgejoRepositoryLocator | null {
  const normalized = value.trim().replace(/\.git$/u, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  return owner && repo ? { owner, repo } : null;
}

function requireRepositoryLocator(
  repository: string,
): Effect.Effect<ForgejoRepositoryLocator, ForgejoApiError> {
  const locator = parseForgejoRepositorySlug(repository);
  return locator
    ? Effect.succeed(locator)
    : Effect.fail(new ForgejoRepositoryLocatorError({ repository }));
}

function parseForgejoRemoteUrl(remoteUrl: string): ForgejoRepositoryLocator | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = /^[a-zA-Z0-9._-]+@[^:/]+:(.+)$/.exec(trimmed);
  if (scpMatch?.[1]) {
    return parseForgejoRepositorySlug(scpMatch[1]);
  }

  try {
    return parseForgejoRepositorySlug(new URL(trimmed).pathname);
  } catch {
    return null;
  }
}

function normalizeRepositoryCloneUrls(
  raw: typeof RawForgejoRepositorySchema.Type,
): SourceControlRepositoryCloneUrls {
  const httpClone = raw.clone_url ?? raw.html_url;
  const sshClone = raw.ssh_url;
  return {
    nameWithOwner: raw.full_name,
    url: httpClone ?? raw.full_name,
    sshUrl: sshClone ?? httpClone ?? raw.full_name,
  };
}

function shouldPreferSshRemote(originRemoteUrl: string | null): boolean {
  if (!originRemoteUrl) return false;
  return isSshRemoteUrl(originRemoteUrl);
}

function selectCloneUrl(input: {
  readonly cloneUrls: SourceControlRepositoryCloneUrls;
  readonly originRemoteUrl: string | null;
}): string {
  return shouldPreferSshRemote(input.originRemoteUrl)
    ? input.cloneUrls.sshUrl
    : input.cloneUrls.url;
}

function checkoutBranchName(input: {
  readonly pullRequestId: number;
  readonly headBranch: string;
  readonly isCrossRepository: boolean;
}): string {
  if (!input.isCrossRepository) {
    return input.headBranch;
  }
  return `t3code/pr-${input.pullRequestId}/${sanitizeBranchFragment(input.headBranch)}`;
}

function repositoryNameWithOwner(
  repository: Schema.Schema.Type<typeof ForgejoPullRequestSchema>["head"]["repo"],
): string | null {
  const fullName = repository?.full_name?.trim() ?? "";
  return fullName.length === 0 ? null : fullName;
}

function repositoryOwnerName(repositoryName: string): string {
  return repositoryName.split("/")[0]?.trim() || "forgejo";
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function instanceApiBase(input: {
  readonly url: string | null;
  readonly apiBaseUrl: string | null;
}): { readonly origin: string; readonly apiBase: string } | null {
  if (input.apiBaseUrl) {
    const origin = originOf(input.apiBaseUrl);
    if (!origin) return null;
    return { origin, apiBase: input.apiBaseUrl.replace(/\/+$/u, "") };
  }
  if (!input.url) return null;
  try {
    const parsed = new URL(input.url);
    const path = parsed.pathname.replace(/\/+$/u, "").replace(/\/api\/v1$/u, "");
    parsed.pathname = path.length === 0 ? "/" : path;
    parsed.search = "";
    parsed.hash = "";
    const instance = parsed.toString().replace(/\/+$/u, "");
    return { origin: parsed.origin, apiBase: `${instance}/api/v1` };
  } catch {
    return null;
  }
}

type ForgejoAuthorizationScheme = "token" | "Bearer";

function authHost(url: string | null): Option.Option<string> {
  return nonEmpty(url ? (originOf(url) ?? url) : undefined);
}

function authFromConfig(input: {
  readonly url: string | null;
  readonly token: string | null;
}): SourceControlProviderAuth {
  if (!input.url || !input.token) {
    return {
      status: "unauthenticated",
      account: Option.none(),
      host: authHost(input.url),
      detail: Option.some(FORGEJO_INSTALL_HINT),
    };
  }
  return {
    status: "unknown",
    account: Option.none(),
    host: authHost(input.url),
    detail: Option.some("Forgejo access token is configured."),
  };
}

function authFromProbeError(input: {
  readonly url: string | null;
  readonly error: ForgejoApiError;
}): SourceControlProviderAuth {
  if (input.error._tag === "ForgejoResponseError" && input.error.status === 401) {
    return {
      status: "unauthenticated",
      account: Option.none(),
      host: authHost(input.url),
      detail: Option.some(
        "The access token was rejected (HTTP 401). Check the token and instance URL.",
      ),
    };
  }
  return {
    status: "unknown",
    account: Option.none(),
    host: authHost(input.url),
    detail: Option.some(input.error.detail),
  };
}

function isUnauthorizedResponse(error: ForgejoApiError): boolean {
  return error._tag === "ForgejoResponseError" && error.status === 401;
}

function otherAuthorizationScheme(scheme: ForgejoAuthorizationScheme): ForgejoAuthorizationScheme {
  return scheme === "token" ? "Bearer" : "token";
}

export function refineUnknownForgejoRemote(input: {
  readonly instanceUrl: string;
  readonly context: SourceControlProvider.SourceControlProviderContext;
}): SourceControlProviderInfo | null {
  if (!remoteUrlMatchesSourceControlHost(input.context.remoteUrl, input.instanceUrl)) {
    return null;
  }
  return {
    kind: "forgejo",
    name: "Forgejo",
    baseUrl: input.instanceUrl.replace(/\/+$/u, ""),
  };
}

function isForgejoRemote(input: {
  readonly remoteUrl: string;
  readonly instanceUrl: string | null;
}): boolean {
  if (detectSourceControlProviderFromRemoteUrl(input.remoteUrl)?.kind === "forgejo") {
    return true;
  }
  return input.instanceUrl
    ? remoteUrlMatchesSourceControlHost(input.remoteUrl, input.instanceUrl)
    : false;
}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const settingsService = yield* ServerSettingsModule.ServerSettingsService;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const textDecoder = new TextDecoder();
  const authorizationScheme = yield* Ref.make<ForgejoAuthorizationScheme>("token");

  const resolveConfig = Effect.fn("ForgejoApi.resolveConfig")(function* () {
    const fromEnv = readForgejoProcessEnv();
    const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
    const secret = yield* secretStore
      .get(FORGEJO_ACCESS_TOKEN_SECRET_NAME)
      .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
    const settingsUrl = configuredText(settings?.forgejoInstanceUrl);
    const secretToken =
      Option.isSome(secret) && secret.value.length > 0
        ? configuredText(textDecoder.decode(secret.value))
        : null;
    const url = settingsUrl ?? fromEnv.url;
    const token = secretToken ?? fromEnv.token;
    return {
      url,
      token,
      endpoints: instanceApiBase({
        url,
        apiBaseUrl: fromEnv.apiBaseUrl,
      }),
    };
  });

  const withAuth = (
    token: string | null,
    request: HttpClientRequest.HttpClientRequest,
    scheme: ForgejoAuthorizationScheme,
  ) => {
    if (!token) return request;
    return request.pipe(HttpClientRequest.setHeader("authorization", `${scheme} ${token}`));
  };

  const rememberAuthorizationScheme = (scheme: ForgejoAuthorizationScheme) =>
    Ref.set(authorizationScheme, scheme);

  const executeAuthorized = <A, E, R>(
    token: string,
    request: HttpClientRequest.HttpClientRequest,
    run: (authorized: HttpClientRequest.HttpClientRequest) => Effect.Effect<A, E, R>,
    isUnauthorized: (error: E) => boolean,
  ): Effect.Effect<A, E, R> =>
    Ref.get(authorizationScheme).pipe(
      Effect.flatMap((preferred) => {
        const fallback = otherAuthorizationScheme(preferred);
        return run(withAuth(token, request, preferred)).pipe(
          Effect.catchIf(isUnauthorized, () =>
            run(withAuth(token, request, fallback)).pipe(
              Effect.tap(() => rememberAuthorizationScheme(fallback)),
            ),
          ),
        );
      }),
    );

  const requireConfig = (
    operation: ForgejoApiOperation,
  ): Effect.Effect<
    {
      readonly url: string | null;
      readonly token: string;
      readonly endpoints: { readonly origin: string; readonly apiBase: string };
    },
    ForgejoApiError
  > =>
    resolveConfig().pipe(
      Effect.flatMap((config) =>
        config.endpoints && config.token
          ? Effect.succeed({
              url: config.url,
              token: config.token,
              endpoints: config.endpoints,
            })
          : Effect.fail(new ForgejoConfigError({ operation })),
      ),
    );

  const decodeResponse = <S extends Schema.Top>(
    operation: ForgejoApiOperation,
    schema: S,
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<S["Type"], ForgejoApiError, S["DecodingServices"]> =>
    HttpClientResponse.matchStatus({
      "2xx": (success) =>
        HttpClientResponse.schemaBodyJson(schema)(success).pipe(
          Effect.mapError(
            (cause) =>
              new ForgejoResponseDecodeError({
                operation,
                status: success.status,
                cause,
              }),
          ),
        ),
      orElse: (failed) => responseError(operation, failed),
    })(response);

  const executeJson = <S extends Schema.Top>(
    operation: ForgejoApiOperation,
    requestFor: (apiBase: string) => HttpClientRequest.HttpClientRequest,
    schema: S,
  ): Effect.Effect<S["Type"], ForgejoApiError, S["DecodingServices"]> =>
    requireConfig(operation).pipe(
      Effect.flatMap((config) =>
        executeAuthorized(
          config.token,
          requestFor(config.endpoints.apiBase).pipe(HttpClientRequest.acceptJson),
          (authorized) =>
            httpClient.execute(authorized).pipe(
              Effect.mapError(
                (cause) =>
                  new ForgejoRequestError({
                    operation,
                    cause,
                  }),
              ),
              Effect.flatMap((response) => decodeResponse(operation, schema, response)),
            ),
          isUnauthorizedResponse,
        ),
      ),
    );

  const resolveRepository = Effect.fn("ForgejoApi.resolveRepository")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) {
    const { url: instanceUrl } = yield* resolveConfig();
    const fromRepository =
      input.repository !== undefined ? parseForgejoRepositorySlug(input.repository) : null;
    if (fromRepository) return fromRepository;

    const fromContext =
      input.context && isForgejoRemote({ remoteUrl: input.context.remoteUrl, instanceUrl })
        ? parseForgejoRemoteUrl(input.context.remoteUrl)
        : null;
    if (fromContext) return fromContext;

    const handle = yield* vcsRegistry.resolve({ cwd: input.cwd }).pipe(
      Effect.mapError(
        (cause) =>
          new ForgejoRepositoryVcsResolveError({
            cwd: input.cwd,
            cause,
          }),
      ),
    );
    const remotes = yield* handle.driver.listRemotes(input.cwd).pipe(
      Effect.mapError(
        (cause) =>
          new ForgejoRepositoryRemotesListError({
            cwd: input.cwd,
            cause,
          }),
      ),
    );

    for (const remote of remotes.remotes) {
      if (!isForgejoRemote({ remoteUrl: remote.url, instanceUrl })) continue;
      const parsed = parseForgejoRemoteUrl(remote.url);
      if (parsed) return parsed;
    }

    return yield* new ForgejoRepositoryRemoteNotFoundError({
      cwd: input.cwd,
    });
  });

  const getRepositoryFromLocator = (repository: ForgejoRepositoryLocator) =>
    executeJson(
      "getRepository",
      (apiBase) =>
        HttpClientRequest.get(
          `${apiBase}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
        ),
      RawForgejoRepositorySchema,
    );

  const getRepository = (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) => resolveRepository(input).pipe(Effect.flatMap(getRepositoryFromLocator));

  const getRawPullRequestFromRepository = (
    repository: ForgejoRepositoryLocator,
    reference: string,
  ) =>
    executeJson(
      "getPullRequest",
      (apiBase) =>
        HttpClientRequest.get(
          `${apiBase}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls/${encodeURIComponent(normalizeChangeRequestId(reference))}`,
        ),
      ForgejoPullRequestSchema,
    );

  const getRawPullRequest = (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly reference: string;
  }) =>
    resolveRepository(input).pipe(
      Effect.flatMap((repository) => getRawPullRequestFromRepository(repository, input.reference)),
    );

  const readConfigValueNullable = (cwd: string, key: string) =>
    git.readConfigValue(cwd, key).pipe(Effect.orElseSucceed(() => null));

  const resolveCheckoutRemote = Effect.fn("ForgejoApi.resolveCheckoutRemote")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly destinationRepository: ForgejoRepositoryLocator;
    readonly sourceRepositoryName: string;
    readonly isCrossRepository: boolean;
  }) {
    const { url: instanceUrl } = yield* resolveConfig();
    if (
      input.context &&
      isForgejoRemote({ remoteUrl: input.context.remoteUrl, instanceUrl }) &&
      !input.isCrossRepository &&
      parseForgejoRemoteUrl(input.context.remoteUrl) !== null
    ) {
      return input.context.remoteName;
    }

    if (!input.isCrossRepository) {
      const remoteName = yield* git
        .resolvePrimaryRemoteName(input.cwd)
        .pipe(Effect.orElseSucceed(() => null));
      if (remoteName) return remoteName;
    }

    const cloneUrls = yield* getRepository({
      cwd: input.cwd,
      repository: input.sourceRepositoryName,
      ...(input.context ? { context: input.context } : {}),
    }).pipe(Effect.map(normalizeRepositoryCloneUrls));
    const originRemoteUrl = yield* readConfigValueNullable(input.cwd, "remote.origin.url");
    return yield* git.ensureRemote({
      cwd: input.cwd,
      preferredName: input.isCrossRepository
        ? repositoryOwnerName(input.sourceRepositoryName)
        : input.destinationRepository.owner,
      url: selectCloneUrl({ cloneUrls, originRemoteUrl }),
    });
  });

  const trustedUrl = (
    config: {
      readonly endpoints: { readonly origin: string; readonly apiBase: string };
    },
    value: string,
  ): string | null => {
    if (!/^https?:\/\//u.test(value)) return `${config.endpoints.apiBase}${value}`;
    const origin = originOf(value);
    return origin !== null && origin === config.endpoints.origin ? value : null;
  };

  const send = (
    config: {
      readonly token: string;
      readonly endpoints: { readonly origin: string; readonly apiBase: string };
    },
    input: {
      readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      readonly url: string;
      readonly body?: string;
      readonly redirects: number;
    },
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, ForgejoApiError> => {
    const url = trustedUrl(config, input.url);
    if (url === null) {
      return Effect.fail(
        new ForgejoUntrustedUrlError({ host: originOf(input.url) ?? "an unreadable url" }),
      );
    }
    const base =
      input.method === "GET"
        ? HttpClientRequest.get(url)
        : input.method === "POST"
          ? HttpClientRequest.post(url)
          : input.method === "DELETE"
            ? HttpClientRequest.make("DELETE")(url)
            : input.method === "PATCH"
              ? HttpClientRequest.make("PATCH")(url)
              : HttpClientRequest.put(url);
    const withBody =
      input.body === undefined
        ? base
        : base.pipe(HttpClientRequest.bodyText(input.body, "application/json"));
    const executeOnce = (scheme: ForgejoAuthorizationScheme) =>
      httpClient.execute(withAuth(config.token, withBody, scheme)).pipe(
        Effect.mapError(
          (cause): ForgejoApiError => new ForgejoRequestError({ operation: "request", cause }),
        ),
        Effect.flatMap((response) => {
          const location = response.headers.location;
          if (
            response.status >= 300 &&
            response.status < 400 &&
            location !== undefined &&
            input.redirects < MAX_REDIRECTS
          ) {
            return send(config, {
              ...input,
              url: new URL(location, url).toString(),
              redirects: input.redirects + 1,
            });
          }
          return Effect.succeed(response);
        }),
      );
    return Ref.get(authorizationScheme).pipe(
      Effect.flatMap((preferred) =>
        executeOnce(preferred).pipe(
          Effect.flatMap((response) => {
            if (response.status !== 401) return Effect.succeed(response);
            const fallback = otherAuthorizationScheme(preferred);
            return executeOnce(fallback).pipe(
              Effect.tap((retry) =>
                retry.status === 401 ? Effect.void : rememberAuthorizationScheme(fallback),
              ),
            );
          }),
        ),
      ),
    );
  };

  const request: ForgejoApi["Service"]["request"] = (input) =>
    requireConfig("request").pipe(
      Effect.flatMap((config) => send(config, { ...input, redirects: 0 })),
      Effect.flatMap((response) =>
        HttpClientResponse.matchStatus({
          "2xx": (success) =>
            collectUint8StreamText({
              stream: success.stream,
              maxBytes: input.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new ForgejoResponseBodyReadError({
                    operation: "request",
                    status: success.status,
                    cause,
                  }),
              ),
              Effect.map((collected) => ({
                body: collected.text,
                truncated: collected.truncated,
              })),
            ),
          orElse: (failed) => responseError("request", failed),
        })(response),
      ),
    );

  return ForgejoApi.of({
    credentials: resolveConfig().pipe(
      Effect.map((config) => ({
        url: config.url,
        token: config.token,
      })),
    ),
    request,
    probeAuth: resolveConfig().pipe(
      Effect.flatMap((config) =>
        config.endpoints && config.token
          ? executeJson(
              "probeAuth",
              (apiBase) => HttpClientRequest.get(`${apiBase}/user`),
              ForgejoUserSchema,
            ).pipe(
              Effect.map((user) => ({
                status: "authenticated" as const,
                account: firstNonEmptyName(user.login, user.username, user.full_name),
                host: authHost(config.url),
                detail: Option.none<string>(),
              })),
              Effect.catch((error) =>
                Effect.succeed(authFromProbeError({ url: config.url, error })),
              ),
            )
          : Effect.succeed(authFromConfig({ url: config.url, token: config.token })),
      ),
    ),
    listPullRequests: (input) =>
      resolveRepository(input).pipe(
        Effect.flatMap((repository) => {
          const source = SourceControlProvider.sourceBranch(input);
          const owner = sourceOwner(input) ?? repository.owner;
          const query: Record<string, string> = {
            state: toForgejoState(input.state),
            limit: String(Math.max(1, Math.min(input.limit ?? 20, 50))),
            page: "1",
            head: `${owner}:${source}`,
          };
          return executeJson(
            "listPullRequests",
            (apiBase) =>
              HttpClientRequest.get(
                `${apiBase}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls`,
                { urlParams: query },
              ),
            ForgejoPullRequestListSchema,
          );
        }),
        Effect.map((list) => {
          const items = list.map(normalizeForgejoPullRequestRecord);
          if (input.state !== "merged") return items;
          return items.filter((item) => item.state === "merged");
        }),
      ),
    getPullRequest: (input) =>
      getRawPullRequest(input).pipe(Effect.map(normalizeForgejoPullRequestRecord)),
    getRepositoryCloneUrls: (input) =>
      getRepository(input).pipe(Effect.map(normalizeRepositoryCloneUrls)),
    createRepository: (input) =>
      requireRepositoryLocator(input.repository).pipe(
        Effect.flatMap((repository) =>
          executeJson(
            "probeAuth",
            (apiBase) => HttpClientRequest.get(`${apiBase}/user`),
            ForgejoUserSchema,
          ).pipe(
            Effect.flatMap((user) => {
              const login = Option.getOrElse(
                firstNonEmptyName(user.login, user.username),
                () => "",
              );
              const body = HttpClientRequest.bodyJsonUnsafe({
                name: repository.repo,
                private: input.visibility === "private",
              });
              const path =
                login.length > 0 && login.toLowerCase() === repository.owner.toLowerCase()
                  ? "/user/repos"
                  : `/orgs/${encodeURIComponent(repository.owner)}/repos`;
              return executeJson(
                "createRepository",
                (apiBase) => HttpClientRequest.post(`${apiBase}${path}`).pipe(body),
                RawForgejoRepositorySchema,
              );
            }),
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      Effect.gen(function* () {
        const repository = yield* resolveRepository(input);
        const body = yield* fileSystem.readFileString(input.bodyFile).pipe(
          Effect.mapError(
            (cause) =>
              new ForgejoPullRequestBodyReadError({
                cwd: input.cwd,
                bodyFile: input.bodyFile,
                cause,
              }),
          ),
        );
        const owner = sourceOwner(input);
        const headBranch = SourceControlProvider.sourceBranch(input);
        const head =
          owner && owner.toLowerCase() !== repository.owner.toLowerCase()
            ? `${owner}:${headBranch}`
            : headBranch;
        yield* executeJson(
          "createPullRequest",
          (apiBase) =>
            HttpClientRequest.post(
              `${apiBase}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls`,
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                title: input.title,
                body,
                head,
                base: input.target?.refName ?? input.baseBranch,
              }),
            ),
          ForgejoPullRequestSchema,
        );
      }),
    getDefaultBranch: (input) =>
      getRepository(input).pipe(
        Effect.map((repository) => repository.default_branch?.trim() || null),
      ),
    checkoutPullRequest: (input) =>
      Effect.gen(function* () {
        const destinationRepository = yield* resolveRepository(input);
        const pullRequest = yield* getRawPullRequestFromRepository(
          destinationRepository,
          input.reference,
        );
        const destinationRepositoryName =
          repositoryNameWithOwner(pullRequest.base.repo) ??
          `${destinationRepository.owner}/${destinationRepository.repo}`;
        const sourceRepositoryName =
          repositoryNameWithOwner(pullRequest.head.repo) ?? destinationRepositoryName;
        const isCrossRepository = sourceRepositoryName !== destinationRepositoryName;
        const remoteName = yield* resolveCheckoutRemote({
          cwd: input.cwd,
          destinationRepository,
          sourceRepositoryName,
          isCrossRepository,
          ...(input.context ? { context: input.context } : {}),
        });
        const remoteBranch = pullRequest.head.ref;
        const localBranch = checkoutBranchName({
          pullRequestId: pullRequest.number,
          headBranch: remoteBranch,
          isCrossRepository,
        });
        const localBranchNames = yield* git.listLocalBranchNames(input.cwd);
        const localBranchExists = localBranchNames.includes(localBranch);

        if (input.force === true || !localBranchExists) {
          yield* git.fetchRemoteBranch({
            cwd: input.cwd,
            remoteName,
            remoteBranch,
            localBranch,
          });
        } else {
          yield* git.fetchRemoteTrackingBranch({
            cwd: input.cwd,
            remoteName,
            remoteBranch,
          });
        }

        yield* git.setBranchUpstream({
          cwd: input.cwd,
          branch: localBranch,
          remoteName,
          remoteBranch,
        });
        yield* Effect.scoped(git.switchRef({ cwd: input.cwd, refName: localBranch }));
      }).pipe(
        Effect.mapError((cause) =>
          isForgejoApiError(cause)
            ? cause
            : new ForgejoCheckoutError({
                cwd: input.cwd,
                reference: input.reference,
                cause,
              }),
        ),
      ),
  });
});

function responseError(
  operation: ForgejoApiOperation,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, ForgejoApiError> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const collected = yield* collectUint8StreamText({
      stream: response.stream,
      maxBytes: DEFAULT_MAX_RESPONSE_BYTES,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ForgejoResponseBodyReadError({
            operation,
            status: response.status,
            cause,
          }),
      ),
    );
    return yield* new ForgejoResponseError({
      operation,
      status: response.status,
      responseBodyLength: collected.text.length,
      retryAt: retryAtFromHeader(response.headers["retry-after"], now),
    });
  });
}

export const layer = Layer.effect(ForgejoApi, make);
