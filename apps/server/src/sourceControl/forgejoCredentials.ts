export const FORGEJO_ACCESS_TOKEN_SECRET_NAME = "forgejo-access-token";
export const FORGEJO_URL_ENV_NAME = "T3CODE_FORGEJO_URL";
export const FORGEJO_TOKEN_ENV_NAME = "T3CODE_FORGEJO_TOKEN";
export const FORGEJO_API_BASE_URL_ENV_NAME = "T3CODE_FORGEJO_API_BASE_URL";

export function lookupEnvValue(
  env: Record<string, string | undefined>,
  name: string,
): string | null {
  const direct = env[name];
  if (direct !== undefined) {
    const trimmed = direct.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  const wanted = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== wanted || value === undefined) continue;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return null;
}

export function readProcessEnvString(name: string): string | null {
  return lookupEnvValue(process.env, name);
}

export function readForgejoProcessEnv(): {
  readonly url: string | null;
  readonly token: string | null;
  readonly apiBaseUrl: string | null;
} {
  return {
    url: readProcessEnvString(FORGEJO_URL_ENV_NAME),
    token: readProcessEnvString(FORGEJO_TOKEN_ENV_NAME),
    apiBaseUrl: readProcessEnvString(FORGEJO_API_BASE_URL_ENV_NAME),
  };
}
