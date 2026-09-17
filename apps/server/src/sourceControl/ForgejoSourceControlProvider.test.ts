import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ForgejoApi from "./ForgejoApi.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

const CLONE_URLS = {
  nameWithOwner: "maria/project",
  url: "https://forgejo.test/maria/project.git",
  sshUrl: "git@forgejo.test:maria/project.git",
};

function testLayer(api: Partial<ForgejoApi.ForgejoApi["Service"]>) {
  return Layer.mergeAll(
    Layer.mock(ForgejoApi.ForgejoApi)(api),
    Layer.mock(ForgejoCli.ForgejoCli)({
      listLogins: () => Effect.succeed([]),
    }),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
    Layer.mock(VcsProcess.VcsProcess)({}),
  );
}

it.effect("uses Settings credentials for Forgejo repository creation", () => {
  const calls: string[] = [];
  return Effect.gen(function* () {
    const provider = yield* ForgejoSourceControlProvider.makeConfigured;
    const result = yield* provider.createRepository({
      cwd: "/repo",
      repository: "maria/project",
      visibility: "private",
    });

    assert.deepStrictEqual(result, CLONE_URLS);
    assert.deepStrictEqual(calls, ["maria/project"]);
  }).pipe(
    Effect.provide(
      testLayer({
        credentials: Effect.succeed({ url: "https://forgejo.test", token: "secret" }),
        createRepository: (input) =>
          Effect.sync(() => {
            calls.push(input.repository);
            return CLONE_URLS;
          }),
      }),
    ),
  );
});

it.effect("uses Settings credentials for ephemeral Git authentication", () => {
  const calls: string[] = [];
  const environment = { GIT_CONFIG_COUNT: "1" };
  return Effect.gen(function* () {
    const provider = yield* ForgejoSourceControlProvider.makeConfigured;
    const result = yield* (
      provider.gitCommandEnvironment?.({
        cwd: "/repo",
        remoteUrl: CLONE_URLS.url,
      }) ?? Effect.die("missing gitCommandEnvironment")
    );

    assert.deepStrictEqual(result, environment);
    assert.deepStrictEqual(calls, [CLONE_URLS.url]);
  }).pipe(
    Effect.provide(
      testLayer({
        credentials: Effect.succeed({ url: "https://forgejo.test", token: "secret" }),
        gitCommandEnvironment: (input) =>
          Effect.sync(() => {
            calls.push(input.remoteUrl);
            return environment;
          }),
      }),
    ),
  );
});

it.effect("reports the Settings-backed Forgejo API as the discovered provider", () => {
  const auth = {
    status: "authenticated" as const,
    account: Option.some("maria"),
    host: Option.some("https://forgejo.test"),
    detail: Option.none<string>(),
  };

  return Effect.gen(function* () {
    const discovery = yield* ForgejoSourceControlProvider.makeConfiguredDiscovery;
    const result = yield* discovery.probe("/repo");

    assert.strictEqual(result.kind, "forgejo");
    assert.strictEqual(result.status, "available");
    assert.deepStrictEqual(result.auth, auth);
    assert.isUndefined(result.executable);
  }).pipe(
    Effect.provide(
      testLayer({
        credentials: Effect.succeed({ url: "https://forgejo.test", token: "secret" }),
        probeAuth: Effect.succeed(auth),
      }),
    ),
  );
});
