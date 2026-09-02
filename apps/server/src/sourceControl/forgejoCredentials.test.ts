import { assert, it } from "@effect/vitest";

import {
  FORGEJO_TOKEN_ENV_NAME,
  FORGEJO_URL_ENV_NAME,
  lookupEnvValue,
  readForgejoProcessEnv,
  readProcessEnvString,
} from "./forgejoCredentials.ts";

it("treats blank process env values as missing", () => {
  const previous = process.env.T3CODE_FORGEJO_CREDENTIALS_TEST;
  process.env.T3CODE_FORGEJO_CREDENTIALS_TEST = "  ";
  try {
    assert.equal(readProcessEnvString("T3CODE_FORGEJO_CREDENTIALS_TEST"), null);
  } finally {
    if (previous === undefined) {
      delete process.env.T3CODE_FORGEJO_CREDENTIALS_TEST;
    } else {
      process.env.T3CODE_FORGEJO_CREDENTIALS_TEST = previous;
    }
  }
});

it("matches env names without regard to case", () => {
  assert.equal(
    lookupEnvValue({ t3code_forgejo_url: " https://git.example.test " }, FORGEJO_URL_ENV_NAME),
    "https://git.example.test",
  );
  assert.equal(lookupEnvValue({ OTHER: "nope" }, FORGEJO_URL_ENV_NAME), null);
});

it("reads Forgejo env vars through process.env getters", () => {
  const previousUrl = process.env[FORGEJO_URL_ENV_NAME];
  const previousToken = process.env[FORGEJO_TOKEN_ENV_NAME];
  process.env[FORGEJO_URL_ENV_NAME] = " https://git.example.test ";
  process.env[FORGEJO_TOKEN_ENV_NAME] = "token";
  try {
    assert.deepEqual(readForgejoProcessEnv(), {
      url: "https://git.example.test",
      token: "token",
      apiBaseUrl: null,
    });
  } finally {
    if (previousUrl === undefined) {
      delete process.env[FORGEJO_URL_ENV_NAME];
    } else {
      process.env[FORGEJO_URL_ENV_NAME] = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env[FORGEJO_TOKEN_ENV_NAME];
    } else {
      process.env[FORGEJO_TOKEN_ENV_NAME] = previousToken;
    }
  }
});
