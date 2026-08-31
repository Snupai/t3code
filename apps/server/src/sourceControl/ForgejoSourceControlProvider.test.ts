import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ForgejoApi from "./ForgejoApi.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

function makeProvider(forgejo: Partial<ForgejoApi.ForgejoApi["Service"]>) {
  return ForgejoSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(ForgejoApi.ForgejoApi)(forgejo)),
  );
}

it.effect("maps Forgejo PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add Forgejo provider",
          url: "https://git.example.test/snupai/t3code/pulls/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          updatedAt: Option.none(),
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/t3code",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "forgejo",
      number: 42,
      title: "Add Forgejo provider",
      url: "https://git.example.test/snupai/t3code/pulls/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/t3code",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);
