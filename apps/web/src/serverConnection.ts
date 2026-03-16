import { Schema } from "effect";
import {
  buildServerAssetUrl,
  buildServerConnectionWebSocketUrl,
  getServerConnectionEndpointDisplay,
  getServerConnectionHttpOrigin,
  getServerConnectionTokenFromUrl,
  isLocalServerProfile,
  MAX_SERVER_PROFILE_COUNT,
  MAX_SERVER_PROFILE_LABEL_LENGTH,
  MAX_SERVER_PROFILE_TOKEN_LENGTH,
  MAX_SERVER_PROFILE_URL_LENGTH,
  normalizeNamedServerConnectionProfiles,
  normalizeServerConnectionUrl,
  resolveLastRemoteServerConnectionProfile,
} from "@t3tools/shared/connectionProfile";

export {
  buildServerAssetUrl,
  buildServerConnectionWebSocketUrl,
  getServerConnectionEndpointDisplay,
  getServerConnectionHttpOrigin,
  isLocalServerProfile,
  MAX_SERVER_PROFILE_COUNT,
  MAX_SERVER_PROFILE_LABEL_LENGTH,
  MAX_SERVER_PROFILE_TOKEN_LENGTH,
  MAX_SERVER_PROFILE_URL_LENGTH,
  normalizeServerConnectionUrl,
  resolveLastRemoteServerConnectionProfile,
};

export const SYSTEM_DESKTOP_LOCAL_PROFILE_ID = "system:desktop-local";
export const SYSTEM_BROWSER_ORIGIN_PROFILE_ID = "system:browser-origin";

const ServerConnectionProfileId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
);

export const ServerConnectionProfile = Schema.Struct({
  id: ServerConnectionProfileId,
  label: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SERVER_PROFILE_LABEL_LENGTH),
  ),
  serverUrl: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SERVER_PROFILE_URL_LENGTH),
  ),
  authToken: Schema.String.check(Schema.isMaxLength(MAX_SERVER_PROFILE_TOKEN_LENGTH)),
  createdAt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  updatedAt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export type ServerConnectionProfile = typeof ServerConnectionProfile.Type;

function toNormalizedSystemProfile(
  id: string,
  label: string,
  rawUrl: string,
): ServerConnectionProfile | null {
  const parsed = normalizeServerConnectionUrl(rawUrl);
  if (!parsed.ok || !parsed.normalizedUrl) {
    return null;
  }
  const now = new Date(0).toISOString();
  return {
    id,
    label,
    serverUrl: parsed.normalizedUrl,
    authToken: getServerConnectionTokenFromUrl(rawUrl).slice(0, MAX_SERVER_PROFILE_TOKEN_LENGTH),
    createdAt: now,
    updatedAt: now,
  };
}

export function getDesktopSystemConnectionProfile(): ServerConnectionProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const desktopUrl = window.desktopBridge?.getWsUrl?.();
  if (typeof desktopUrl !== "string" || desktopUrl.trim().length === 0) {
    return null;
  }
  return toNormalizedSystemProfile(SYSTEM_DESKTOP_LOCAL_PROFILE_ID, "This device", desktopUrl);
}

export function getBrowserSystemConnectionProfile(): ServerConnectionProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const protocol = window.location.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }
  return toNormalizedSystemProfile(
    SYSTEM_BROWSER_ORIGIN_PROFILE_ID,
    "Current browser origin",
    `${protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`,
  );
}

export function getSystemConnectionProfiles(): ServerConnectionProfile[] {
  const desktopProfile = getDesktopSystemConnectionProfile();
  if (desktopProfile) {
    return [desktopProfile];
  }
  const browserProfile = getBrowserSystemConnectionProfile();
  return browserProfile ? [browserProfile] : [];
}

export function getDefaultServerProfileId(): string {
  return getSystemConnectionProfiles()[0]?.id ?? SYSTEM_BROWSER_ORIGIN_PROFILE_ID;
}

export function isReservedServerProfileId(profileId: string): boolean {
  return (
    profileId === SYSTEM_DESKTOP_LOCAL_PROFILE_ID || profileId === SYSTEM_BROWSER_ORIGIN_PROFILE_ID
  );
}

export function getServerConnectionScopeKey(
  profile: Pick<ServerConnectionProfile, "serverUrl">,
): string {
  return `server:${profile.serverUrl}`;
}

export function normalizeServerConnectionProfiles(
  profiles: Iterable<ServerConnectionProfile | null | undefined>,
): ServerConnectionProfile[] {
  return normalizeNamedServerConnectionProfiles(profiles, {
    isReservedId: isReservedServerProfileId,
  });
}

export function resolveServerConnectionProfiles(
  savedProfiles: readonly ServerConnectionProfile[],
): ServerConnectionProfile[] {
  return [...getSystemConnectionProfiles(), ...normalizeServerConnectionProfiles(savedProfiles)];
}

export function resolveServerConnectionProfileById(
  savedProfiles: readonly ServerConnectionProfile[],
  profileId: string | null | undefined,
): ServerConnectionProfile | null {
  const profiles = resolveServerConnectionProfiles(savedProfiles);
  if (profileId) {
    const byId = profiles.find((profile) => profile.id === profileId);
    if (byId) {
      return byId;
    }
  }
  return profiles[0] ?? null;
}
