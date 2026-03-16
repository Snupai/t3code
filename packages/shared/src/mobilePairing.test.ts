import { describe, expect, it } from "vitest";

import {
  buildMobilePairingLink,
  decodeServerConnectionProfileImport,
  encodeServerConnectionProfileImport,
  parseMobilePairingLink,
} from "./mobilePairing";

describe("mobilePairing", () => {
  const payload = {
    version: 1 as const,
    label: "Tailnet desktop",
    serverUrl: "wss://100.64.0.10:3773/",
    authToken: "secret-token",
  };

  it("round-trips profile imports through base64url encoding", () => {
    expect(
      decodeServerConnectionProfileImport(encodeServerConnectionProfileImport(payload)),
    ).toEqual(payload);
  });

  it("builds and parses pairing links", () => {
    expect(parseMobilePairingLink(buildMobilePairingLink(payload))).toEqual(payload);
  });
});
