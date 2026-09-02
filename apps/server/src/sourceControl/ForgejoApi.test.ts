import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
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
import { FORGEJO_ACCESS_TOKEN_SECRET_NAME } from "./forgejoCredentials.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

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

const FORGEJO_ENV_NAMES = [
  "T3CODE_FORGEJO_URL",
  "T3CODE_FORGEJO_TOKEN",
  "T3CODE_FORGEJO_API_BASE_URL",
] as const;

function applyForgejoTestEnv(env: Record<string, string>) {
  const previous = new Map<string, string | undefined>();
  for (const name of FORGEJO_ENV_NAMES) {
    previous.set(name, process.env[name]);
    const value = env[name];
    if (value === undefined) continue;
    if (value.length === 0) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  return () => {
    for (const name of FORGEJO_ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly requestFailure?: (
    request: HttpClientRequest.HttpClientRequest,
  ) => HttpClientError.HttpClientError;
  readonly env?: Record<string, string>;
  readonly settingsUrl?: string;
  readonly secretToken?: string;
}) {
  const restoreEnv = applyForgejoTestEnv({
    T3CODE_FORGEJO_URL: "https://git.example.test",
    T3CODE_FORGEJO_TOKEN: "token",
    ...input.env,
  });
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
    Layer.provideMerge(
      ServerSettingsModule.layerTest({
        forgejoInstanceUrl: input.settingsUrl ?? "",
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) =>
          Effect.succeed(
            name === FORGEJO_ACCESS_TOKEN_SECRET_NAME && input.secretToken
              ? Option.some(new TextEncoder().encode(input.secretToken))
              : Option.none(),
          ),
        set: () => Effect.void,
        create: () => Effect.void,
        getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
        remove: () => Effect.void,
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  return { execute, layer, restoreEnv };
}

it.effect("parses pull request responses from the Forgejo REST API", () => {
  const { execute, layer, restoreEnv } = makeLayer({
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
      headRepositoryNameWithOwner: "snupai/t3code",
      headRepositoryOwnerLogin: "snupai",
    });
    assert.strictEqual(
      execute.mock.calls[0]?.[0].url,
      "https://git.example.test/api/v1/repos/snupai/t3code/pulls/42",
    );
    assert.strictEqual(execute.mock.calls[0]?.[0].headers.authorization, "token token");
  }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(restoreEnv)));
});

it.effect("returns clone URLs from the repository payload", () => {
  const { execute, layer, restoreEnv } = makeLayer({
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
  }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(restoreEnv)));
});

it.effect("reports unauthenticated when Forgejo credentials are missing", () => {
  const { layer, restoreEnv } = makeLayer({
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
  }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(restoreEnv)));
});

it.effect("probes the signed-in Forgejo account", () => {
  const { layer, restoreEnv } = makeLayer({
    response: () => Response.json({ login: "snupai", full_name: "Snupai" }),
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const auth = yield* forgejo.probeAuth;
    assert.strictEqual(auth.status, "authenticated");
    assert.deepStrictEqual(auth.account, Option.some("snupai"));
  }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(restoreEnv)));
});

it.effect("uses Settings credentials when process env is empty", () => {
  const { execute, layer, restoreEnv } = makeLayer({
    response: () => Response.json({ login: "snupai" }),
    env: {
      T3CODE_FORGEJO_URL: "",
      T3CODE_FORGEJO_TOKEN: "",
    },
    settingsUrl: "https://git.example.test",
    secretToken: "settings-token",
  });

  return Effect.gen(function* () {
    const forgejo = yield* ForgejoApi.ForgejoApi;
    const auth = yield* forgejo.probeAuth;
    assert.strictEqual(auth.status, "authenticated");
    assert.deepStrictEqual(auth.account, Option.some("snupai"));
    assert.strictEqual(execute.mock.calls[0]?.[0].headers.authorization, "token settings-token");
  }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(restoreEnv)));
});

it("claims unknown remotes that belong to the configured Forgejo", () => {
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
