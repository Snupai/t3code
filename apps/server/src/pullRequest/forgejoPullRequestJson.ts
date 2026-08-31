import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  PullRequestActor,
  PullRequestComment,
  PullRequestCommit,
  PullRequestMergeability,
  PullRequestState,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

const RawUserSchema = Schema.Struct({
  login: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  username: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  full_name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawRepoSchema = Schema.Struct({
  full_name: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  permissions: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        admin: Schema.optional(Schema.Boolean),
        push: Schema.optional(Schema.Boolean),
        pull: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});

const RawPullRequestSchema = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  merged: Schema.optional(Schema.Boolean),
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  draft: Schema.optional(Schema.Boolean),
  user: Schema.optional(Schema.NullOr(RawUserSchema)),
  created_at: Schema.String,
  updated_at: Schema.String,
  closed_at: Schema.optional(Schema.NullOr(Schema.String)),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(Schema.Int)),
  deletions: Schema.optional(Schema.NullOr(Schema.Int)),
  changed_files: Schema.optional(Schema.NullOr(Schema.Int)),
  comments: Schema.optional(Schema.NullOr(Schema.Int)),
  requested_reviewers: Schema.optional(Schema.NullOr(Schema.Array(RawUserSchema))),
  base: Schema.Struct({
    ref: TrimmedNonEmptyString,
    repo: Schema.optional(Schema.NullOr(RawRepoSchema)),
  }),
  head: Schema.Struct({
    ref: TrimmedNonEmptyString,
    repo: Schema.optional(Schema.NullOr(RawRepoSchema)),
  }),
});

const RawCommentSchema = Schema.Struct({
  id: Schema.Int,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  user: Schema.optional(Schema.NullOr(RawUserSchema)),
});

const RawCommitSchema = Schema.Struct({
  sha: TrimmedNonEmptyString,
  created: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  commit: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        message: Schema.optional(Schema.NullOr(Schema.String)),
        committer: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              date: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
        author: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              name: Schema.optional(Schema.NullOr(Schema.String)),
              date: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
  author: Schema.optional(Schema.NullOr(RawUserSchema)),
});

export interface ForgejoPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: PullRequestActor | null;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability: PullRequestMergeability;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
  readonly body: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly commentCount: number;
  readonly reviewRequestLogins: ReadonlyArray<string>;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly canWrite: boolean;
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function toIsoUtc(value: string): string {
  return Option.match(DateTime.make(value), {
    onNone: () => value,
    onSome: DateTime.formatIso,
  });
}

function toActor(raw: Schema.Schema.Type<typeof RawUserSchema> | null | undefined) {
  const login = trimmed(raw?.login) ?? trimmed(raw?.username);
  return login === null
    ? null
    : {
        login,
        name: trimmed(raw?.full_name),
        avatarUrl: trimmed(raw?.avatar_url),
      };
}

function toState(raw: Schema.Schema.Type<typeof RawPullRequestSchema>): PullRequestState {
  if (raw.merged === true) return "merged";
  switch (raw.state?.trim().toLowerCase()) {
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

function toMergeability(mergeable: boolean | null | undefined): PullRequestMergeability {
  if (mergeable === true) return "mergeable";
  if (mergeable === false) return "conflicting";
  return "unknown";
}

function toPullRequest(raw: Schema.Schema.Type<typeof RawPullRequestSchema>): ForgejoPullRequest {
  const reviewers = (raw.requested_reviewers ?? []).flatMap((reviewer) => {
    const actor = toActor(reviewer);
    return actor === null ? [] : [actor];
  });
  const permissions = raw.base.repo?.permissions;
  return {
    number: raw.number,
    title: raw.title,
    url: trimmed(raw.html_url) ?? `#${raw.number}`,
    author: toActor(raw.user),
    headBranch: raw.head.ref,
    baseBranch: raw.base.ref,
    state: toState(raw),
    isDraft: raw.draft ?? false,
    mergeability: toMergeability(raw.mergeable),
    createdAt: toIsoUtc(raw.created_at),
    updatedAt: toIsoUtc(raw.updated_at),
    closedAt: trimmed(raw.closed_at) ? toIsoUtc(raw.closed_at as string) : null,
    mergedAt: trimmed(raw.merged_at) ? toIsoUtc(raw.merged_at as string) : null,
    body: raw.body ?? "",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    commentCount: raw.comments ?? 0,
    reviewRequestLogins: reviewers.map((reviewer) => reviewer.login),
    reviewers,
    canWrite: permissions?.push === true || permissions?.admin === true,
  };
}

function toComment(raw: Schema.Schema.Type<typeof RawCommentSchema>): PullRequestComment {
  return {
    id: String(raw.id),
    kind: "issue-comment",
    author: toActor(raw.user),
    body: raw.body ?? "",
    createdAt: toIsoUtc(raw.created_at),
    url: trimmed(raw.html_url),
    path: null,
    reviewState: null,
  };
}

function toCommit(raw: Schema.Schema.Type<typeof RawCommitSchema>): PullRequestCommit {
  const message = raw.commit?.message ?? "";
  const headline = message.split("\n")[0] ?? "";
  const date =
    trimmed(raw.commit?.committer?.date) ??
    trimmed(raw.commit?.author?.date) ??
    trimmed(raw.created_at) ??
    trimmed(raw.created) ??
    new Date(0).toISOString();
  const author = toActor(raw.author);
  return {
    oid: raw.sha,
    messageHeadline: headline,
    committedDate: toIsoUtc(date),
    ...(author ? { authors: [author] } : {}),
  };
}

const decodePullRequest = decodeJsonResult(RawPullRequestSchema);
const decodePullRequestList = decodeJsonResult(Schema.Array(RawPullRequestSchema));
const decodeCommentList = decodeJsonResult(Schema.Array(RawCommentSchema));
const decodeCommitList = decodeJsonResult(Schema.Array(RawCommitSchema));
const decodeUser = decodeJsonResult(RawUserSchema);
const decodeRepository = decodeJsonResult(RawRepoSchema);

export function decodePullRequestJson(body: string) {
  const decoded = decodePullRequest(body);
  return Result.map(decoded, toPullRequest);
}

export function decodePullRequestListJson(body: string) {
  const decoded = decodePullRequestList(body);
  return Result.map(decoded, (items) => items.map(toPullRequest));
}

export function decodeCommentListJson(body: string) {
  const decoded = decodeCommentList(body);
  return Result.map(decoded, (items) => items.map(toComment));
}

export function decodeCommitListJson(body: string) {
  const decoded = decodeCommitList(body);
  return Result.map(decoded, (items) => items.map(toCommit));
}

export function decodeViewerJson(body: string) {
  const decoded = decodeUser(body);
  return Result.map(decoded, (user) => toActor(user)?.login ?? null);
}

export function decodeRepositoryPermissionJson(body: string) {
  const decoded = decodeRepository(body);
  return Result.map(
    decoded,
    (repository) => repository.permissions?.push === true || repository.permissions?.admin === true,
  );
}
