import { toSortedCompat } from "./array";

export const MAX_SERVER_PROFILE_COUNT = 16;
export const MAX_SERVER_PROFILE_LABEL_LENGTH = 80;
export const MAX_SERVER_PROFILE_URL_LENGTH = 2048;
export const MAX_SERVER_PROFILE_TOKEN_LENGTH = 4096;

export interface ServerConnectionUrlParseResult {
  readonly ok: boolean;
  readonly normalizedUrl: string | null;
  readonly error: string | null;
}

export interface ServerConnectionProfileShape {
  readonly serverUrl: string;
}

export interface ServerConnectionAuthProfileShape extends ServerConnectionProfileShape {
  readonly authToken: string;
}

export interface NamedServerConnectionProfileShape extends ServerConnectionAuthProfileShape {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function coerceToWebSocketProtocol(protocol: string): string | null {
  switch (protocol) {
    case "http:":
      return "ws:";
    case "https:":
      return "wss:";
    case "ws:":
    case "wss:":
      return protocol;
    default:
      return null;
  }
}

function formatServerUrl(url: URL): string {
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getServerConnectionTokenFromUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `ws://${trimmed}`;

  try {
    return new URL(candidate).searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function normalizeServerConnectionUrl(input: string): ServerConnectionUrlParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      normalizedUrl: null,
      error: "Enter a server URL or host:port.",
    };
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `ws://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      normalizedUrl: null,
      error: "Enter a valid server URL or host:port.",
    };
  }

  const protocol = coerceToWebSocketProtocol(parsed.protocol);
  if (!protocol) {
    return {
      ok: false,
      normalizedUrl: null,
      error: "Only ws://, wss://, http://, and https:// URLs are supported.",
    };
  }

  if (parsed.hostname.trim().length === 0) {
    return {
      ok: false,
      normalizedUrl: null,
      error: "Enter a valid hostname or IP address.",
    };
  }

  parsed.protocol = protocol;
  parsed.username = "";
  parsed.password = "";

  const normalizedUrl = formatServerUrl(parsed);
  if (normalizedUrl.length > MAX_SERVER_PROFILE_URL_LENGTH) {
    return {
      ok: false,
      normalizedUrl: null,
      error: `Server URLs must be ${MAX_SERVER_PROFILE_URL_LENGTH} characters or less.`,
    };
  }

  return {
    ok: true,
    normalizedUrl,
    error: null,
  };
}

export function buildServerConnectionWebSocketUrl(
  profile: Pick<ServerConnectionAuthProfileShape, "serverUrl" | "authToken">,
): string {
  const url = new URL(profile.serverUrl);
  if (profile.authToken.trim().length > 0) {
    url.searchParams.set("token", profile.authToken.trim());
  }
  return url.toString();
}

export function getServerConnectionHttpOrigin(
  profile: Pick<ServerConnectionProfileShape, "serverUrl">,
): string {
  const wsUrl = new URL(profile.serverUrl);
  const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${wsUrl.host}`;
}

export function getServerConnectionEndpointDisplay(
  profile: Pick<ServerConnectionProfileShape, "serverUrl">,
): string {
  return new URL(profile.serverUrl).host;
}

export function isLocalServerProfile(
  profile: Pick<ServerConnectionProfileShape, "serverUrl">,
): boolean {
  const host = new URL(profile.serverUrl).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function buildServerAssetUrl(
  profile: Pick<ServerConnectionAuthProfileShape, "serverUrl" | "authToken">,
  pathOrUrl: string,
): string {
  if (!pathOrUrl.startsWith("/")) {
    return pathOrUrl;
  }
  const url = new URL(pathOrUrl, getServerConnectionHttpOrigin(profile));
  if (profile.authToken.trim().length > 0) {
    url.searchParams.set("token", profile.authToken.trim());
  }
  return url.toString();
}

export function normalizeNamedServerConnectionProfiles<T extends NamedServerConnectionProfileShape>(
  profiles: Iterable<T | null | undefined>,
  options?: { readonly isReservedId?: (profileId: string) => boolean },
): T[] {
  const normalizedProfiles: T[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const candidate of profiles) {
    if (!candidate) {
      continue;
    }

    const id = candidate.id.trim();
    if (
      id.length === 0 ||
      seenIds.has(id) ||
      (options?.isReservedId ? options.isReservedId(id) : false)
    ) {
      continue;
    }

    const parsed = normalizeServerConnectionUrl(candidate.serverUrl);
    if (!parsed.ok || !parsed.normalizedUrl || seenUrls.has(parsed.normalizedUrl)) {
      continue;
    }

    const label = candidate.label.trim();
    if (label.length === 0) {
      continue;
    }

    seenIds.add(id);
    seenUrls.add(parsed.normalizedUrl);
    normalizedProfiles.push({
      ...candidate,
      id,
      label: label.slice(0, MAX_SERVER_PROFILE_LABEL_LENGTH),
      serverUrl: parsed.normalizedUrl,
      authToken: candidate.authToken.trim().slice(0, MAX_SERVER_PROFILE_TOKEN_LENGTH),
    });

    if (normalizedProfiles.length >= MAX_SERVER_PROFILE_COUNT) {
      break;
    }
  }

  return normalizedProfiles;
}

export function resolveLastRemoteServerConnectionProfile<
  T extends NamedServerConnectionProfileShape,
>(
  savedProfiles: readonly T[],
  preferredProfileIds: readonly (string | null | undefined)[] = [],
): T | null {
  const remoteProfiles = normalizeNamedServerConnectionProfiles(savedProfiles).filter(
    (profile) => !isLocalServerProfile(profile),
  );

  for (const preferredProfileId of preferredProfileIds) {
    if (!preferredProfileId) {
      continue;
    }
    const matchingProfile = remoteProfiles.find((profile) => profile.id === preferredProfileId);
    if (matchingProfile) {
      return matchingProfile;
    }
  }

  return (
    toSortedCompat(remoteProfiles, (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ?? null
  );
}
