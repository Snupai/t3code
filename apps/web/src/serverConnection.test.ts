import { afterEach, describe, expect, it } from "vitest";

import {
  buildServerConnectionWebSocketUrl,
  getDesktopSystemConnectionProfile,
  resolveLastRemoteServerConnectionProfile,
} from "./serverConnection";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    return;
  }
  Reflect.deleteProperty(globalThis, "window");
});

describe("serverConnection", () => {
  it("preserves the desktop preload auth token when normalizing the system profile", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getWsUrl: () => "ws://127.0.0.1:3773/?token=desktop-secret",
        },
      },
    });

    const profile = getDesktopSystemConnectionProfile();

    expect(profile).toEqual(
      expect.objectContaining({
        serverUrl: "ws://127.0.0.1:3773/",
        authToken: "desktop-secret",
      }),
    );

    expect(buildServerConnectionWebSocketUrl(profile!)).toBe(
      "ws://127.0.0.1:3773/?token=desktop-secret",
    );
  });

  it("resolves the last remote profile from preferred ids before falling back to recency", () => {
    const remoteOlder = {
      id: "remote-older",
      label: "Older remote",
      serverUrl: "wss://100.64.0.10:3773/",
      authToken: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remoteNewer = {
      id: "remote-newer",
      label: "Newer remote",
      serverUrl: "wss://100.64.0.20:3773/",
      authToken: "",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    expect(
      resolveLastRemoteServerConnectionProfile([remoteOlder, remoteNewer], ["remote-older"]),
    ).toEqual(remoteOlder);
    expect(resolveLastRemoteServerConnectionProfile([remoteOlder, remoteNewer])).toEqual(
      remoteNewer,
    );
  });
});
