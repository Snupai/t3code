import { describe, expect, it } from "vitest";

import {
  buildServerConnectionWebSocketUrl,
  normalizeNamedServerConnectionProfiles,
  normalizeServerConnectionUrl,
  resolveLastRemoteServerConnectionProfile,
} from "./connectionProfile";

describe("connectionProfile", () => {
  it("normalizes HTTP(S) URLs into websocket origins", () => {
    expect(normalizeServerConnectionUrl("https://100.64.0.10:3773/chat")).toEqual({
      ok: true,
      normalizedUrl: "wss://100.64.0.10:3773/",
      error: null,
    });
  });

  it("preserves auth tokens when building websocket URLs", () => {
    expect(
      buildServerConnectionWebSocketUrl({
        serverUrl: "ws://127.0.0.1:3773/",
        authToken: "desktop-secret",
      }),
    ).toBe("ws://127.0.0.1:3773/?token=desktop-secret");
  });

  it("deduplicates normalized profile URLs", () => {
    const profiles = normalizeNamedServerConnectionProfiles([
      {
        id: "remote-1",
        label: "Tailnet A",
        serverUrl: "https://100.64.0.1:3773/chat",
        authToken: " secret ",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "remote-2",
        label: "Tailnet B",
        serverUrl: "wss://100.64.0.1:3773/",
        authToken: "",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    expect(profiles).toEqual([
      {
        id: "remote-1",
        label: "Tailnet A",
        serverUrl: "wss://100.64.0.1:3773/",
        authToken: "secret",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("resolves the last remote profile from preferred ids before recency", () => {
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
