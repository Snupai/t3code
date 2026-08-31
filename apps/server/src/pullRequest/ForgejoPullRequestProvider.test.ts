import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as ForgejoPullRequestApi from "./ForgejoPullRequestApi.ts";
import * as ForgejoPullRequestProvider from "./ForgejoPullRequestProvider.ts";
import { decodePullRequestJson } from "./forgejoPullRequestJson.ts";

it("decodes a Forgejo pull request payload", () => {
  const decoded = decodePullRequestJson(
    JSON.stringify({
      number: 12,
      title: "Add Forgejo",
      body: "Hello",
      html_url: "https://git.example.test/snupai/t3code/pulls/12",
      state: "open",
      merged: false,
      mergeable: true,
      draft: false,
      user: { login: "snupai", avatar_url: "https://git.example.test/avatars/1" },
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-03T00:00:00Z",
      additions: 4,
      deletions: 1,
      changed_files: 2,
      comments: 1,
      requested_reviewers: [],
      base: { ref: "main", repo: { full_name: "snupai/t3code", permissions: { push: true } } },
      head: { ref: "feature", repo: { full_name: "snupai/t3code" } },
    }),
  );

  assert.ok(Result.isSuccess(decoded));
  if (!Result.isSuccess(decoded)) return;
  assert.strictEqual(decoded.success.number, 12);
  assert.strictEqual(decoded.success.mergeability, "mergeable");
  assert.strictEqual(decoded.success.canWrite, true);
  assert.strictEqual(decoded.success.author?.login, "snupai");
});

it.effect("maps Forgejo pull requests into the review page's change-request shape", () =>
  Effect.gen(function* () {
    const provider = yield* ForgejoPullRequestProvider.make.pipe(
      Effect.provide(
        Layer.mock(ForgejoPullRequestApi.ForgejoPullRequestApi)({
          getPullRequest: () =>
            Effect.succeed({
              number: 12,
              title: "Add Forgejo",
              url: "https://git.example.test/snupai/t3code/pulls/12",
              author: { login: "snupai", name: null, avatarUrl: null },
              headBranch: "feature",
              baseBranch: "main",
              state: "open" as const,
              isDraft: false,
              mergeability: "mergeable" as const,
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
              closedAt: null,
              mergedAt: null,
              body: "Hello",
              additions: 4,
              deletions: 1,
              changedFiles: 2,
              commentCount: 1,
              reviewRequestLogins: [],
              reviewers: [],
              canWrite: true,
            }),
        }),
      ),
    );

    const detail = yield* provider.getChangeRequest({
      cwd: "/repo",
      host: "git.example.test",
      repository: "snupai/t3code",
      number: 12,
    });

    assert.strictEqual(detail.number, 12);
    assert.strictEqual(detail.body, "Hello");
    assert.deepStrictEqual(detail.mergeCapabilities, {
      merge: true,
      squash: true,
      rebase: true,
    });
  }),
);
