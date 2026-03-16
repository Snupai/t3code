import type os from "node:os";

import type {
  DesktopRemoteAccessStatus,
  DesktopServerConnectionDetails,
  DesktopServerConnectionEndpoint,
} from "@t3tools/contracts";

interface ResolveDesktopServerConnectionDetailsInput {
  readonly authToken: string;
  readonly diagnosticMessage?: string | null;
  readonly localWsUrl: string | null;
  readonly networkInterfaces: ReturnType<typeof os.networkInterfaces>;
  readonly port: number;
  readonly remoteAccessEnabled: boolean;
  readonly remoteAccessStatus?: Extract<
    DesktopRemoteAccessStatus,
    "starting" | "reachable" | "failed"
  >;
}

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "localhost";
}

function isLinkLocalAddress(address: string): boolean {
  return address.startsWith("169.254.");
}

function isTailscaleAddress(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  const [first, second] = octets;
  return (
    octets.length === 4 && first === 100 && second !== undefined && second >= 64 && second <= 127
  );
}

function isPrivateLanAddress(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  const [first, second] = octets;
  if (octets.length !== 4 || first === undefined || second === undefined) {
    return false;
  }
  if (first === 10 || (first === 192 && second === 168)) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
}

function connectionLabel(interfaceName: string, address: string): string {
  if (isTailscaleAddress(address)) {
    return `Tailscale (${interfaceName})`;
  }
  if (isPrivateLanAddress(address)) {
    return `Local network (${interfaceName})`;
  }
  return `Network (${interfaceName})`;
}

function addressPriority(address: string): number {
  if (isTailscaleAddress(address)) {
    return 0;
  }
  if (isPrivateLanAddress(address)) {
    return 1;
  }
  return 2;
}

function makeEndpoint(
  interfaceName: string,
  address: string,
  port: number,
  authToken: string,
): DesktopServerConnectionEndpoint {
  const httpUrl = `http://${address}:${port}`;
  const serverUrl = `ws://${address}:${port}/`;
  return {
    address,
    interfaceName,
    label: connectionLabel(interfaceName, address),
    httpUrl,
    serverUrl,
    copyText: `Server URL: ${serverUrl}\nAuth token: ${authToken}`,
  };
}

export function resolvePreferredRemoteEndpoint(
  endpoints: readonly DesktopServerConnectionEndpoint[],
): DesktopServerConnectionEndpoint | null {
  return (
    endpoints.find((endpoint) => isTailscaleAddress(endpoint.address)) ??
    endpoints.find((endpoint) => isPrivateLanAddress(endpoint.address)) ??
    null
  );
}

function resolveHealthcheckUrl(endpoint: DesktopServerConnectionEndpoint | null): string | null {
  return endpoint ? `${endpoint.httpUrl}/api/healthz` : null;
}

export function resolveDesktopServerConnectionDetails(
  input: ResolveDesktopServerConnectionDetailsInput,
): DesktopServerConnectionDetails {
  const endpoints: DesktopServerConnectionEndpoint[] = [];
  const seenAddresses = new Set<string>();

  for (const [interfaceName, entries] of Object.entries(input.networkInterfaces)) {
    for (const entry of entries ?? []) {
      if (!isIpv4Family(entry.family) || entry.internal) {
        continue;
      }
      const address = entry.address.trim();
      if (
        address.length === 0 ||
        seenAddresses.has(address) ||
        isLoopbackAddress(address) ||
        isLinkLocalAddress(address)
      ) {
        continue;
      }
      seenAddresses.add(address);
      endpoints.push(makeEndpoint(interfaceName, address, input.port, input.authToken));
    }
  }

  endpoints.sort((left, right) => {
    const byPriority = addressPriority(left.address) - addressPriority(right.address);
    if (byPriority !== 0) {
      return byPriority;
    }
    const byInterface = left.interfaceName.localeCompare(right.interfaceName);
    if (byInterface !== 0) {
      return byInterface;
    }
    return left.address.localeCompare(right.address);
  });

  const selectedEndpoint = resolvePreferredRemoteEndpoint(endpoints);
  const healthcheckUrl = resolveHealthcheckUrl(selectedEndpoint);
  const remoteAccessStatus: DesktopRemoteAccessStatus = !input.remoteAccessEnabled
    ? "disabled"
    : !selectedEndpoint
      ? "no-interface"
      : (input.remoteAccessStatus ?? "starting");

  return {
    port: input.port,
    authToken: input.authToken,
    localWsUrl: input.localWsUrl,
    remoteAccessEnabled: input.remoteAccessEnabled,
    remoteAccessStatus,
    selectedEndpoint,
    diagnosticMessage: input.diagnosticMessage ?? null,
    healthcheckUrl,
    endpoints,
  };
}
