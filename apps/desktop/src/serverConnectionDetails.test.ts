import { describe, expect, it } from "vitest";

import { resolveDesktopServerConnectionDetails } from "./serverConnectionDetails";

describe("resolveDesktopServerConnectionDetails", () => {
  it("prefers the first Tailscale endpoint for remote access", () => {
    const details = resolveDesktopServerConnectionDetails({
      port: 3773,
      authToken: "secret-token",
      localWsUrl: "ws://127.0.0.1:3773/?token=secret-token",
      remoteAccessEnabled: true,
      remoteAccessStatus: "reachable",
      networkInterfaces: {
        lo0: [
          {
            address: "127.0.0.1",
            family: "IPv4",
            internal: true,
            cidr: null,
            mac: "",
            netmask: "255.0.0.0",
          },
        ],
        en0: [
          {
            address: "192.168.1.42",
            family: "IPv4",
            internal: false,
            cidr: null,
            mac: "",
            netmask: "255.255.255.0",
          },
        ],
        utun4: [
          {
            address: "100.88.12.2",
            family: "IPv4",
            internal: false,
            cidr: null,
            mac: "",
            netmask: "255.192.0.0",
          },
        ],
      },
    });

    expect(details.remoteAccessStatus).toBe("reachable");
    expect(details.selectedEndpoint).toEqual({
      address: "100.88.12.2",
      interfaceName: "utun4",
      label: "Tailscale (utun4)",
      httpUrl: "http://100.88.12.2:3773",
      serverUrl: "ws://100.88.12.2:3773/",
      copyText: "Server URL: ws://100.88.12.2:3773/\nAuth token: secret-token",
    });
    expect(details.healthcheckUrl).toBe("http://100.88.12.2:3773/api/healthz");
  });

  it("falls back to LAN when no Tailscale address is available", () => {
    const details = resolveDesktopServerConnectionDetails({
      port: 4555,
      authToken: "secret-token",
      localWsUrl: null,
      remoteAccessEnabled: true,
      remoteAccessStatus: "starting",
      networkInterfaces: {
        en0: [
          {
            address: "192.168.1.42",
            family: "IPv4",
            internal: false,
            cidr: null,
            mac: "",
            netmask: "255.255.255.0",
          },
          {
            address: "169.254.12.44",
            family: "IPv4",
            internal: false,
            cidr: null,
            mac: "",
            netmask: "255.255.0.0",
          },
        ],
        en1: [
          {
            address: "192.168.1.42",
            family: "IPv4",
            internal: false,
            cidr: null,
            mac: "",
            netmask: "255.255.255.0",
          },
        ],
      },
    });

    expect(details.remoteAccessStatus).toBe("starting");
    expect(details.selectedEndpoint?.address).toBe("192.168.1.42");
    expect(details.endpoints).toHaveLength(1);
  });

  it("reports disabled or no-interface states without a selected endpoint", () => {
    const disabledDetails = resolveDesktopServerConnectionDetails({
      port: 3773,
      authToken: "secret-token",
      localWsUrl: null,
      remoteAccessEnabled: false,
      networkInterfaces: {},
    });
    const noInterfaceDetails = resolveDesktopServerConnectionDetails({
      port: 3773,
      authToken: "secret-token",
      localWsUrl: null,
      remoteAccessEnabled: true,
      networkInterfaces: {},
    });

    expect(disabledDetails.remoteAccessStatus).toBe("disabled");
    expect(disabledDetails.selectedEndpoint).toBeNull();
    expect(noInterfaceDetails.remoteAccessStatus).toBe("no-interface");
    expect(noInterfaceDetails.selectedEndpoint).toBeNull();
  });
});
