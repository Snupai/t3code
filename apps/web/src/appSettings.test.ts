import { afterEach, describe, expect, it } from "vitest";

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_TIMESTAMP_FORMAT,
  getAppModelOptions,
  normalizeCustomModelSlugs,
  patchStoredAppSettings,
  readStoredAppSettings,
  resolveAppModelSelection,
} from "./appSettings";
import { SYSTEM_BROWSER_ORIGIN_PROFILE_ID } from "./serverConnection";
import { removeLocalStorageItem } from "./hooks/useLocalStorage";

afterEach(() => {
  removeLocalStorageItem(APP_SETTINGS_STORAGE_KEY);
});

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("remote server profiles", () => {
  it("defaults the active profile to the browser system profile", () => {
    expect(readStoredAppSettings().activeServerProfileId).toBe(SYSTEM_BROWSER_ORIGIN_PROFILE_ID);
  });

  it("persists and normalizes saved remote profiles", () => {
    removeLocalStorageItem(APP_SETTINGS_STORAGE_KEY);

    patchStoredAppSettings((current) => ({
      ...current,
      serverProfiles: [
        {
          id: "remote-1",
          label: "Tailnet",
          serverUrl: "https://100.64.0.1:3773/chat",
          authToken: " secret ",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      activeServerProfileId: "remote-1",
    }));

    expect(readStoredAppSettings().serverProfiles).toEqual([
      {
        id: "remote-1",
        label: "Tailnet",
        serverUrl: "wss://100.64.0.1:3773/",
        authToken: "secret",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(readStoredAppSettings().activeServerProfileId).toBe("remote-1");
  });

  it("tracks the active remote profile as the last quick-switch target", () => {
    removeLocalStorageItem(APP_SETTINGS_STORAGE_KEY);

    patchStoredAppSettings((current) => ({
      ...current,
      serverProfiles: [
        {
          id: "remote-1",
          label: "Tailnet A",
          serverUrl: "wss://100.64.0.1:3773/",
          authToken: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "remote-2",
          label: "Tailnet B",
          serverUrl: "wss://100.64.0.2:3773/",
          authToken: "",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      activeServerProfileId: "remote-1",
      lastRemoteServerProfileId: "missing-profile",
    }));

    expect(readStoredAppSettings().lastRemoteServerProfileId).toBe("remote-1");
  });
});
