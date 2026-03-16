import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConnectionProfileImport } from "./mobile";

describe("ServerConnectionProfileImport", () => {
  it("decodes valid profile import payloads", () => {
    const payload = Schema.decodeUnknownSync(ServerConnectionProfileImport)({
      version: 1,
      label: "Tailnet desktop",
      serverUrl: "wss://100.64.0.10:3773/",
      authToken: "secret-token",
    });

    expect(payload).toEqual({
      version: 1,
      label: "Tailnet desktop",
      serverUrl: "wss://100.64.0.10:3773/",
      authToken: "secret-token",
    });
  });

  it("rejects empty labels", () => {
    expect(() =>
      Schema.decodeUnknownSync(ServerConnectionProfileImport)({
        version: 1,
        label: "   ",
        serverUrl: "wss://100.64.0.10:3773/",
        authToken: "secret-token",
      }),
    ).toThrow();
  });
});
