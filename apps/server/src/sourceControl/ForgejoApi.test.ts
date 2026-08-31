import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import * as ForgejoApi from "./ForgejoApi.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";

const forgejoPullRequest = {
  number: 42,
  title: "Add Forgejo provider",
  html_url: "https://git.example.test/snupai/t3code/pulls/42",
  state: "open",
  merged: false,
  updated_at: "2026-01-02T00:00:00.000Z",
  head: {
    ref: "feature/source-control",
    repo: {
      full_name: "snupai/t3code",
      owner: { login: "snupai" },
    },
  },
  base: {
    ref: "main",
    repo: {
      full_name: "snupai/t3code",
      owner: { login: "snupai" },
    },
  },
};

const repositoryJson = {
  full_name: "snupai/t3code",
  clone_url: "https://git.example.test/snupai/t3code.git",
  ssh_url: "git@git.example.test:snupai/t3code.git",
  html_url: "https://git.example.test/snupai/t3code",
  default_branch: "main",
};

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly requestFailure?: (
    request: HttpClientRequest.HttpClientRequest,
  ) => HttpClientError.HttpClientError;
  readonly env?: Record<string, string>;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    input.requestFailure
      ? Effect.fail(input.requestFailure(request))
      : Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const git = {
    readConfigValue: () => Effect.succeed<string | null>("git@git.example.test:snupai/t3code.git"),
    resolvePrimaryRemoteName: () => Effect.succeed("origin"),
    ensureRemote: () => Effect.succeed("origin"),
    fetchRemoteBranch: () => Effect.void,
    fetchRemoteTrackingBranch: () => Effect.void,
    setBranchUpstream: () => Effect.void,
    switchRef: (request: { readonly refName: string }) =>
      Effect.succeed({ refName: request.refName }),
    listLocalBranchNames: () => Effect.succeed<string[]>([]),
  } satisfies Partial<GitVcsDriver.GitVcsDriver["Service"]>;

  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: [
          {
            name: "origin",
            url: "git@git.example.test:snupai/t3code.git",
            pushUrl: Option.none(),
            isPrimary: true,
          },
        ],
        freshness: {
          source: "live-local" as const,
          observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const layer = ForgejoApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        resolve: () =>
          Effect.succeed({
            kind: "git",
            repository: {
              kind: "git",
              rootPath: "/repo",
              metadataPath: null,
              freshness: {
                source: "live-local" as const,
                observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                expiresAt: Option.none(),
              },
            },
            driver: driver as unknown as VcsDriver.VcsDriver["Service"],
          }),
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)(git)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_FORGEJO_URL: "https://git.example.test",
            T3CODE_FORGEJO_TOKEN: "token",
            ...input.env,
          },
        }),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  return { execute, layer };
}

it.effect("parses pull request responses from the Forgejo REST API", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json(forgejoPullRequest),
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const result = yield* forgejo.getPullRequest({
      cwd: "/repo",
      reference: "#42",
    });

    assert.deepStrictEqual(result, {
      number: 42,
      title: "Add Forgejo provider",
      url: "https://git.example.test/snupai/t3code/pulls/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    });
    assert.strictEqual(
      execute.mock.calls[0]?.[0].url,
      "https://git.example.test/api/v1/repos/snupai/t3code/pulls/42",
    );
    assert.strictEqual(execute.mock.calls[0]?.[0].headers.authorization, "token token");
  }).pipe(Effect.provide(layer));
});

it.effect("returns clone URLs from the repository payload", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json(repositoryJson),
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const result = yield* forgejo.getRepositoryCloneUrls({
      cwd: "/repo",
      repository: "snupai/t3code",
    });

    assert.deepStrictEqual(result, {
      nameWithOwner: "snupai/t3code",
      url: "https://git.example.test/snupai/t3code.git",
      sshUrl: "git@git.example.test:snupai/t3code.git",
    });
    assert.strictEqual(
      execute.mock.calls[0]?.[0].url,
      "https://git.example.test/api/v1/repos/snupai/t3code",
    );
  }).pipe(Effect.provide(layer));
});

it.effect("reports unauthenticated when Forgejo credentials are missing", () => {
  const { layer } = makeLayer({
    response: () => Response.json({ login: "snupai" }),
    env: {
      T3CODE_FORGEJO_URL: "",
      T3CODE_FORGEJO_TOKEN: "",
    },
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const auth = yield* forgejo.probeAuth;
    assert.strictEqual(auth.status, "unauthenticated");
  }).pipe(Effect.provide(layer));
});

it.effect("probes the signed-in Forgejo account", () => {
  const { layer } = makeLayer({
    response: () => Response.json({ login: "snupai", full_name: "Snupai" }),
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const auth = yield* forgejo.probeAuth;
    assert.strictEqual(auth.status, "authenticated");
    assert.deepStrictEqual(auth.account, Option.some("snupai"));
  }).pipe(Effect.provide(layer));
});

it.effect("claims unknown remotes that belong to the configured Forgejo", () => {
  const context = {
    provider: {
      kind: "unknown" as const,
      name: "git.example.test",
      baseUrl: "https://git.example.test",
    },
    remoteName: "origin",
    remoteUrl: "git@git.example.test:snupai/t3code.git",
  };

  assert.deepStrictEqual(
    ForgejoApi.refineUnknownForgejoRemote({
      instanceUrl: "https://git.example.test",
      context,
    }),
    {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.test",
    },
  );
  assert.strictEqual(
    ForgejoApi.refineUnknownForgejoRemote({
      instanceUrl: "https://codeberg.org",
      context,
    }),
    null,
  );
});
