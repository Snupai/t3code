import * as Effect from "effect/Effect";
import type { PullRequestCapabilities, PullRequestViewerPermissions } from "@t3tools/contracts";

import * as ForgejoPullRequestApi from "./ForgejoPullRequestApi.ts";
import {
  PullRequestProviderError,
  type PullRequestProviderFailure,
  type ProviderChangeRequest,
  type ProviderChangeRequestActivity,
  type ProviderChangeRequestDetail,
  type PullRequestProviderApi,
} from "./PullRequestProvider.ts";
import type { ForgejoPullRequest } from "./forgejoPullRequestJson.ts";

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: ["merge", "close", "reopen"],
  mergeMethods: ["merge", "squash", "rebase"],
  search: false,
  reactions: false,
  review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
  reviewers: { request: false, listCandidates: false },
  edit: { changeRequest: true, comment: true },
};

export function forgejoViewerPermissions(input: {
  readonly canWrite: boolean;
}): PullRequestViewerPermissions {
  return {
    actions: CAPABILITIES.actions.filter((action) => action !== "merge" || input.canWrite),
    comment: true,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  };
}

export function forgejoProviderFailure(
  error: ForgejoPullRequestApi.ForgejoPullRequestApiError,
): PullRequestProviderFailure {
  if (error._tag === "ForgejoResponseError" && error.status === 401) {
    return { reason: "unauthenticated" };
  }
  if (error._tag === "ForgejoResponseError" && error.status === 429) {
    return {
      reason: "rate-limited",
      ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
    };
  }
  if (error._tag === "ForgejoConfigError") {
    return { reason: "unauthenticated" };
  }
  return { reason: "failed" };
}

function toChangeRequest(pullRequest: ForgejoPullRequest): ProviderChangeRequest {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    author: pullRequest.author,
    headBranch: pullRequest.headBranch,
    baseBranch: pullRequest.baseBranch,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergeability: pullRequest.mergeability,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    reviewRequestLogins: pullRequest.reviewRequestLogins,
    labels: [],
  };
}

export const make = Effect.gen(function* () {
  const api = yield* ForgejoPullRequestApi.ForgejoPullRequestApi;

  const fail = (operation: string) => (error: ForgejoPullRequestApi.ForgejoPullRequestApiError) =>
    new PullRequestProviderError({
      provider: "forgejo",
      operation,
      ...forgejoProviderFailure(error),
      detail: error.detail,
      cause: error,
    });

  const unsupported = (operation: string) =>
    Effect.fail(
      new PullRequestProviderError({
        provider: "forgejo",
        operation,
        reason: "failed",
        detail: "Forgejo reviews cannot be written from here yet.",
      }),
    );

  const provider: PullRequestProviderApi = {
    kind: "forgejo",
    capabilities: CAPABILITIES,

    getViewer: () => api.getViewer().pipe(Effect.mapError(fail("getViewer"))),

    listChangeRequests: (input) =>
      api
        .listPullRequests({
          repository: input.repository,
          state: input.state,
          limit: input.limit,
          cursor: input.cursor,
        })
        .pipe(
          Effect.mapError(fail("listChangeRequests")),
          Effect.map((batch) => ({
            items: batch.items.map(toChangeRequest),
            truncated: batch.truncated,
            continues: true,
          })),
        ),

    getChangeRequest: (input) =>
      api.getPullRequest({ repository: input.repository, number: input.number }).pipe(
        Effect.mapError(fail("getChangeRequest")),
        Effect.map(
          (pullRequest): ProviderChangeRequestDetail => ({
            ...toChangeRequest(pullRequest),
            body: pullRequest.body,
            changedFiles: pullRequest.changedFiles,
            mergedAt: pullRequest.mergedAt,
            closedAt: pullRequest.closedAt,
            reviewers: pullRequest.reviewers,
            checks: [],
            mergeCapabilities: { merge: true, squash: true, rebase: true },
            viewerPermissions: forgejoViewerPermissions({ canWrite: pullRequest.canWrite }),
          }),
        ),
      ),

    getChangeRequestActivity: (input) => {
      const target = { repository: input.repository, number: input.number };
      return Effect.all(
        [
          api.listComments(target).pipe(Effect.orElseSucceed(() => [])),
          api.listCommits(target).pipe(Effect.orElseSucceed(() => [])),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.mapError(fail("getChangeRequestActivity")),
        Effect.map(
          ([comments, commits]): ProviderChangeRequestActivity => ({
            comments,
            commentCount: comments.length,
            commentsTruncated: comments.length >= 50,
            reviewThreads: [],
            commits,
          }),
        ),
      );
    },

    getViewerPermissions: (input) =>
      api.getRepositoryPermission({ repository: input.repository }).pipe(
        Effect.mapError(fail("getViewerPermissions")),
        Effect.map((canWrite) => forgejoViewerPermissions({ canWrite })),
      ),

    getDiff: (input) =>
      api
        .getPullRequestDiff({
          repository: input.repository,
          number: input.number,
        })
        .pipe(
          Effect.mapError(fail("getDiff")),
          Effect.map((diff) => ({ ...diff, nextCursor: null })),
        ),

    listReviewerCandidates: () =>
      Effect.fail(
        new PullRequestProviderError({
          provider: "forgejo",
          operation: "listReviewerCandidates",
          reason: "failed",
          detail: "Forgejo cannot say who may review a pull request from here yet.",
        }),
      ),

    setReviewerRequest: () => unsupported("setReviewerRequest"),

    runAction: (input) =>
      api
        .runAction({
          repository: input.repository,
          number: input.number,
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
        })
        .pipe(Effect.mapError(fail("runAction"))),

    updateChangeRequest: (input) =>
      api
        .updateChangeRequest({
          repository: input.repository,
          number: input.number,
          title: input.title,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("updateChangeRequest"))),

    comment: (input) =>
      api
        .comment({ repository: input.repository, number: input.number, body: input.body })
        .pipe(Effect.mapError(fail("comment"))),

    updateComment: (input) => {
      if (input.kind !== "issue-comment") {
        return unsupported("updateComment");
      }
      return api
        .updateComment({
          repository: input.repository,
          commentId: input.commentId,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("updateComment")));
    },

    submitReview: () => unsupported("submitReview"),
    replyToThread: () => unsupported("replyToThread"),
    setThreadResolution: () => unsupported("setThreadResolution"),
    setReaction: () => unsupported("setReaction"),
  };

  return provider;
});
