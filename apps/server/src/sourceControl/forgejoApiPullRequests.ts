import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";

export interface NormalizedForgejoPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

const ForgejoRepositoryRefSchema = Schema.Struct({
  full_name: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  owner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
      }),
    ),
  ),
});

const ForgejoPullRequestBranchSchema = Schema.Struct({
  ref: TrimmedNonEmptyString,
  repo: Schema.optional(Schema.NullOr(ForgejoRepositoryRefSchema)),
});

export const ForgejoPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  html_url: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  merged: Schema.optional(Schema.Boolean),
  updated_at: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  base: ForgejoPullRequestBranchSchema,
  head: ForgejoPullRequestBranchSchema,
});

export const ForgejoPullRequestListSchema = Schema.Array(ForgejoPullRequestSchema);

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

function repositoryName(
  repository: Schema.Schema.Type<typeof ForgejoRepositoryRefSchema> | null | undefined,
): string | null {
  return trimOptionalString(repository?.full_name);
}

function repositoryOwner(
  repository: Schema.Schema.Type<typeof ForgejoRepositoryRefSchema> | null | undefined,
): string | null {
  return (
    trimOptionalString(repository?.owner?.login) ??
    (repository?.full_name?.includes("/") ? (repository.full_name.split("/")[0] ?? null) : null)
  );
}

function normalizeForgejoPullRequestState(input: {
  readonly state: string | null | undefined;
  readonly merged: boolean | undefined;
}): "open" | "closed" | "merged" {
  if (input.merged === true) return "merged";
  switch (input.state?.trim().toLowerCase()) {
    case "closed":
      return "closed";
    case "open":
    default:
      return "open";
  }
}

export function normalizeForgejoPullRequestRecord(
  raw: Schema.Schema.Type<typeof ForgejoPullRequestSchema>,
): NormalizedForgejoPullRequestRecord {
  const headRepositoryNameWithOwner = repositoryName(raw.head.repo);
  const baseRepositoryNameWithOwner = repositoryName(raw.base.repo);
  const headRepositoryOwnerLogin = repositoryOwner(raw.head.repo);
  const isCrossRepository =
    headRepositoryNameWithOwner !== null &&
    baseRepositoryNameWithOwner !== null &&
    headRepositoryNameWithOwner !== baseRepositoryNameWithOwner;

  return {
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    baseRefName: raw.base.ref,
    headRefName: raw.head.ref,
    state: normalizeForgejoPullRequestState({ state: raw.state, merged: raw.merged }),
    updatedAt: raw.updated_at ?? Option.none(),
    ...(isCrossRepository ? { isCrossRepository: true } : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}
