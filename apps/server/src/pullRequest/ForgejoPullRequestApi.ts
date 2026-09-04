import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestCommit,
  PullRequestListState,
  PullRequestMergeMethod,
} from "@t3tools/contracts";

import * as ForgejoApi from "../sourceControl/ForgejoApi.ts";
import {
  decodeCommentListJson,
  decodeCommitListJson,
  decodePullRequestJson,
  decodePullRequestListJson,
  decodeRepositoryPermissionJson,
  decodeViewerJson,
  type ForgejoPullRequest,
} from "./forgejoPullRequestJson.ts";
import type { ProviderListCursor } from "./PullRequestProvider.ts";

export class ForgejoPullRequestReadError extends Schema.TaggedErrorClass<ForgejoPullRequestReadError>()(
  "ForgejoPullRequestReadError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Forgejo returned an unreadable ${this.operation} response.`;
  }

  override get message(): string {
    return `Forgejo failed in ${this.operation}: ${this.detail}`;
  }
}

export class ForgejoViewerUnavailableError extends Schema.TaggedErrorClass<ForgejoViewerUnavailableError>()(
  "ForgejoViewerUnavailableError",
  {},
) {
  get detail(): string {
    return "Forgejo returned no account name for the configured credentials.";
  }

  override get message(): string {
    return `Forgejo failed in getViewer: ${this.detail}`;
  }
}

export class ForgejoRepositoryUnsupportedError extends Schema.TaggedErrorClass<ForgejoRepositoryUnsupportedError>()(
  "ForgejoRepositoryUnsupportedError",
  {
    repository: Schema.String,
  },
) {
  get detail(): string {
    return "Forgejo repositories must be specified as owner/repository.";
  }

  override get message(): string {
    return `Forgejo failed in resolveRepository: ${this.detail}`;
  }
}

export const ForgejoPullRequestApiError = Schema.Union([
  ForgejoApi.ForgejoApiError,
  ForgejoPullRequestReadError,
  ForgejoViewerUnavailableError,
  ForgejoRepositoryUnsupportedError,
]);
export type ForgejoPullRequestApiError = typeof ForgejoPullRequestApiError.Type;

function parseRepository(
  repository: string,
): { readonly owner: string; readonly repo: string } | null {
  const parts = repository
    .trim()
    .replace(/\.git$/u, "")
    .split("/")
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  return owner && repo ? { owner, repo } : null;
}

function forgejoState(state: PullRequestListState): string {
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

function mergeDo(method: PullRequestMergeMethod | undefined): string {
  switch (method) {
    case "squash":
      return "squash";
    case "rebase":
      return "rebase";
    case "merge":
    case undefined:
      return "merge";
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export class ForgejoPullRequestApi extends Context.Service<
  ForgejoPullRequestApi,
  {
    readonly getViewer: () => Effect.Effect<string, ForgejoPullRequestApiError>;
    readonly listPullRequests: (input: {
      readonly repository: string;
      readonly state: PullRequestListState;
      readonly limit: number;
      readonly cursor?: ProviderListCursor | undefined;
    }) => Effect.Effect<
      {
        readonly items: ReadonlyArray<ForgejoPullRequest>;
        readonly truncated: boolean;
      },
      ForgejoPullRequestApiError
    >;
    readonly getPullRequest: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ForgejoPullRequest, ForgejoPullRequestApiError>;
    readonly listComments: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<PullRequestComment>, ForgejoPullRequestApiError>;
    readonly listCommits: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<PullRequestCommit>, ForgejoPullRequestApiError>;
    readonly getPullRequestDiff: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<
      { readonly patch: string; readonly truncated: boolean },
      ForgejoPullRequestApiError
    >;
    readonly getRepositoryPermission: (input: {
      readonly repository: string;
    }) => Effect.Effect<boolean, ForgejoPullRequestApiError>;
    readonly runAction: (input: {
      readonly repository: string;
      readonly number: number;
      readonly action: PullRequestAction;
      readonly mergeMethod?: PullRequestMergeMethod;
    }) => Effect.Effect<void, ForgejoPullRequestApiError>;
    readonly updateChangeRequest: (input: {
      readonly repository: string;
      readonly number: number;
      readonly title?: string | undefined;
      readonly body?: string | undefined;
    }) => Effect.Effect<void, ForgejoPullRequestApiError>;
    readonly comment: (input: {
      readonly repository: string;
      readonly number: number;
      readonly body: string;
    }) => Effect.Effect<void, ForgejoPullRequestApiError>;
    readonly updateComment: (input: {
      readonly repository: string;
      readonly commentId: string;
      readonly body: string;
    }) => Effect.Effect<void, ForgejoPullRequestApiError>;
  }
>()("t3/pullRequest/ForgejoPullRequestApi") {}

export const make = Effect.gen(function* () {
  const forgejo = yield* ForgejoApi.ForgejoApi;

  const withRepository = <A, E>(
    repository: string,
    body: (path: string) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ForgejoRepositoryUnsupportedError> => {
    const locator = parseRepository(repository);
    if (!locator) {
      return Effect.fail(new ForgejoRepositoryUnsupportedError({ repository }));
    }
    return body(`/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`);
  };

  const readJson = <A>(input: {
    readonly operation: string;
    readonly url: string;
    readonly decode: (body: string) => Result.Result<A, unknown>;
  }): Effect.Effect<A, ForgejoPullRequestApiError> =>
    forgejo.request({ method: "GET", url: input.url }).pipe(
      Effect.flatMap((response) => {
        const decoded = input.decode(response.body);
        return Result.isSuccess(decoded)
          ? Effect.succeed(decoded.success)
          : Effect.fail(
              new ForgejoPullRequestReadError({
                operation: input.operation,
                cause: decoded.failure,
              }),
            );
      }),
    );

  return ForgejoPullRequestApi.of({
    getViewer: () =>
      readJson({ operation: "getViewer", url: "/user", decode: decodeViewerJson }).pipe(
        Effect.flatMap((login) =>
          login === null ? Effect.fail(new ForgejoViewerUnavailableError()) : Effect.succeed(login),
        ),
      ),

    listPullRequests: (input) =>
      withRepository(input.repository, (path) => {
        const pageSize = Math.max(1, Math.min(input.limit, 50));
        const page =
          input.cursor === undefined ? 1 : Math.floor(input.cursor.delivered / pageSize) + 1;
        const query = new URLSearchParams({
          state: forgejoState(input.state),
          limit: String(pageSize),
          page: String(page),
          sort: "recentupdate",
        });
        return readJson({
          operation: "listPullRequests",
          url: `${path}/pulls?${query.toString()}`,
          decode: decodePullRequestListJson,
        }).pipe(
          Effect.map((items) => {
            const filtered =
              input.state === "merged" ? items.filter((item) => item.state === "merged") : items;
            return {
              items: filtered.slice(0, input.limit),
              truncated: items.length >= pageSize,
            };
          }),
        );
      }),

    getPullRequest: (input) =>
      withRepository(input.repository, (path) =>
        readJson({
          operation: "getPullRequest",
          url: `${path}/pulls/${input.number}`,
          decode: decodePullRequestJson,
        }),
      ),

    listComments: (input) =>
      withRepository(input.repository, (path) =>
        readJson({
          operation: "listComments",
          url: `${path}/issues/${input.number}/comments?limit=50`,
          decode: decodeCommentListJson,
        }),
      ),

    listCommits: (input) =>
      withRepository(input.repository, (path) =>
        readJson({
          operation: "listCommits",
          url: `${path}/pulls/${input.number}/commits?limit=50`,
          decode: decodeCommitListJson,
        }),
      ),

    getPullRequestDiff: (input) =>
      withRepository(input.repository, (path) =>
        forgejo
          .request({ method: "GET", url: `${path}/pulls/${input.number}.diff` })
          .pipe(
            Effect.map((response) => ({ patch: response.body, truncated: response.truncated })),
          ),
      ),

    getRepositoryPermission: (input) =>
      withRepository(input.repository, (path) =>
        readJson({
          operation: "getRepositoryPermission",
          url: path,
          decode: decodeRepositoryPermissionJson,
        }),
      ),

    runAction: (input) => {
      const failUnsupported = Effect.fail(
        new ForgejoPullRequestReadError({
          operation: "runAction",
          cause: new Error(`Unsupported Forgejo pull request action: ${input.action}`),
        }),
      );
      switch (input.action) {
        case "merge":
          return withRepository(input.repository, (path) =>
            forgejo
              .request({
                method: "POST",
                url: `${path}/pulls/${input.number}/merge`,
                body: JSON.stringify({ Do: mergeDo(input.mergeMethod) }),
              })
              .pipe(Effect.asVoid),
          );
        case "close":
          return withRepository(input.repository, (path) =>
            forgejo
              .request({
                method: "PATCH",
                url: `${path}/pulls/${input.number}`,
                body: JSON.stringify({ state: "closed" }),
              })
              .pipe(Effect.asVoid),
          );
        case "reopen":
          return withRepository(input.repository, (path) =>
            forgejo
              .request({
                method: "PATCH",
                url: `${path}/pulls/${input.number}`,
                body: JSON.stringify({ state: "open" }),
              })
              .pipe(Effect.asVoid),
          );
        case "ready":
        case "draft":
        case "update-branch":
        case "enable-auto-merge":
        case "disable-auto-merge":
        case "approve-workflows":
        case "revert":
          return failUnsupported;
        default: {
          const _exhaustive: never = input.action;
          return _exhaustive;
        }
      }
    },

    updateChangeRequest: (input) =>
      withRepository(input.repository, (path) =>
        forgejo
          .request({
            method: "PATCH",
            url: `${path}/pulls/${input.number}`,
            body: JSON.stringify({
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.body === undefined ? {} : { body: input.body }),
            }),
          })
          .pipe(Effect.asVoid),
      ),

    comment: (input) =>
      withRepository(input.repository, (path) =>
        forgejo
          .request({
            method: "POST",
            url: `${path}/issues/${input.number}/comments`,
            body: JSON.stringify({ body: input.body }),
          })
          .pipe(Effect.asVoid),
      ),

    updateComment: (input) =>
      withRepository(input.repository, (path) =>
        forgejo
          .request({
            method: "PATCH",
            url: `${path}/issues/comments/${encodeURIComponent(input.commentId)}`,
            body: JSON.stringify({ body: input.body }),
          })
          .pipe(Effect.asVoid),
      ),
  });
});

export const layer = Layer.effect(ForgejoPullRequestApi, make);
