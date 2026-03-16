import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getDefaultDesktopSettings,
  readDesktopSettings,
  resolveDesktopSettingsPath,
  writeDesktopSettings,
} from "./desktopSettings";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopSettings", () => {
  it("generates and persists a desktop auth token on first read", () => {
    const stateDir = makeTempDir("t3code-desktop-settings-");

    const firstRead = readDesktopSettings(stateDir);
    const secondRead = readDesktopSettings(stateDir);

    expect(firstRead.remoteAccessEnabled).toBe(false);
    expect(firstRead.authToken).toMatch(/^[0-9a-f]{48}$/);
    expect(secondRead).toEqual(firstRead);
  });

  it("persists remote access enablement and manual auth token updates", () => {
    const stateDir = makeTempDir("t3code-desktop-settings-");

    const saved = writeDesktopSettings(stateDir, {
      remoteAccessEnabled: true,
      authToken: "manual-auth-token",
    });

    expect(saved).toEqual({
      remoteAccessEnabled: true,
      authToken: "manual-auth-token",
    });
    expect(readDesktopSettings(stateDir)).toEqual({
      remoteAccessEnabled: true,
      authToken: "manual-auth-token",
    });
  });

  it("repairs legacy settings files that do not have an auth token yet", () => {
    const stateDir = makeTempDir("t3code-desktop-settings-");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      resolveDesktopSettingsPath(stateDir),
      JSON.stringify({ remoteAccessEnabled: true }),
      "utf8",
    );

    const settings = readDesktopSettings(stateDir);

    expect(settings.remoteAccessEnabled).toBe(true);
    expect(settings.authToken).toMatch(/^[0-9a-f]{48}$/);
    expect(readDesktopSettings(stateDir)).toEqual(settings);
  });

  it("falls back to defaults for corrupted settings files", () => {
    const stateDir = makeTempDir("t3code-desktop-settings-");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(resolveDesktopSettingsPath(stateDir), "{bad-json", "utf8");

    const settings = readDesktopSettings(stateDir);

    expect(settings.remoteAccessEnabled).toBe(getDefaultDesktopSettings().remoteAccessEnabled);
    expect(settings.authToken).toMatch(/^[0-9a-f]{48}$/);
  });
});
