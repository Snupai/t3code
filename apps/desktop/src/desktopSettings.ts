import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DesktopSettings {
  readonly remoteAccessEnabled: boolean;
  readonly authToken: string;
}

const DESKTOP_SETTINGS_FILE_NAME = "desktop-settings.json";
const DESKTOP_AUTH_TOKEN_BYTES = 24;

function persistDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tempPath, settingsPath);
}

export function resolveDesktopSettingsPath(stateDir: string): string {
  return path.join(stateDir, DESKTOP_SETTINGS_FILE_NAME);
}

export function createDesktopAuthToken(): string {
  return crypto.randomBytes(DESKTOP_AUTH_TOKEN_BYTES).toString("hex");
}

function normalizeDesktopSettings(
  candidate: unknown,
  fallbackAuthToken = createDesktopAuthToken(),
): DesktopSettings {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      remoteAccessEnabled: false,
      authToken: fallbackAuthToken,
    };
  }

  const authTokenCandidate = (candidate as { authToken?: unknown }).authToken;
  const authToken =
    typeof authTokenCandidate === "string" && authTokenCandidate.trim().length > 0
      ? authTokenCandidate.trim()
      : fallbackAuthToken;

  return {
    remoteAccessEnabled:
      (candidate as { remoteAccessEnabled?: unknown }).remoteAccessEnabled === true,
    authToken,
  };
}

function hasPersistedDesktopSettingsShape(candidate: unknown): candidate is DesktopSettings {
  return (
    !!candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    typeof (candidate as { remoteAccessEnabled?: unknown }).remoteAccessEnabled === "boolean" &&
    typeof (candidate as { authToken?: unknown }).authToken === "string" &&
    (candidate as { authToken: string }).authToken.trim().length > 0
  );
}

export function readDesktopSettings(stateDir: string): DesktopSettings {
  const settingsPath = resolveDesktopSettingsPath(stateDir);
  let rawCandidate: unknown;
  let needsRepair = false;
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    rawCandidate = JSON.parse(raw);
  } catch {
    rawCandidate = null;
    needsRepair = true;
  }

  const normalized = normalizeDesktopSettings(rawCandidate);
  if (needsRepair || !hasPersistedDesktopSettingsShape(rawCandidate)) {
    persistDesktopSettings(settingsPath, normalized);
  }
  return normalized;
}

export function writeDesktopSettings(
  stateDir: string,
  settings: Partial<DesktopSettings>,
): DesktopSettings {
  const nextSettings = normalizeDesktopSettings({
    ...readDesktopSettings(stateDir),
    ...settings,
  });
  const settingsPath = resolveDesktopSettingsPath(stateDir);
  persistDesktopSettings(settingsPath, nextSettings);
  return nextSettings;
}

export function getDefaultDesktopSettings(): DesktopSettings {
  return normalizeDesktopSettings(null);
}
