import { Schema } from "effect";
import { ServerConnectionProfileImport } from "@t3tools/contracts";

export const MOBILE_PAIRING_SCHEME = "t3code";
export const MOBILE_PAIRING_HOST = "connect";

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] ?? 0;
    const byte1 = bytes[index + 1] ?? 0;
    const byte2 = bytes[index + 2] ?? 0;
    const chunk = (byte0 << 16) | (byte1 << 8) | byte2;
    encoded += BASE64_URL_ALPHABET[(chunk >> 18) & 63] ?? "";
    encoded += BASE64_URL_ALPHABET[(chunk >> 12) & 63] ?? "";
    encoded += index + 1 < bytes.length ? (BASE64_URL_ALPHABET[(chunk >> 6) & 63] ?? "") : "";
    encoded += index + 2 < bytes.length ? (BASE64_URL_ALPHABET[chunk & 63] ?? "") : "";
  }
  return encoded;
}

function decodeBase64Url(input: string): Uint8Array {
  const sanitized = input.trim();
  if (sanitized.length === 0) {
    return new Uint8Array();
  }
  if (!/^[-_A-Za-z0-9]+$/.test(sanitized)) {
    throw new Error("Invalid pairing payload encoding.");
  }

  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const char of sanitized) {
    const index = BASE64_URL_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid pairing payload encoding.");
    }
    buffer = (buffer << 6) | index;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error("Invalid pairing payload padding.");
  }

  return new Uint8Array(bytes);
}

export function encodeServerConnectionProfileImport(
  payload: ServerConnectionProfileImport,
): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeServerConnectionProfileImport(
  payload: string,
): ServerConnectionProfileImport {
  const json = new TextDecoder().decode(decodeBase64Url(payload));
  return Schema.decodeUnknownSync(ServerConnectionProfileImport)(JSON.parse(json));
}

export function buildMobilePairingLink(payload: ServerConnectionProfileImport): string {
  const url = new URL(`${MOBILE_PAIRING_SCHEME}://${MOBILE_PAIRING_HOST}`);
  url.searchParams.set("payload", encodeServerConnectionProfileImport(payload));
  return url.toString();
}

export function parseMobilePairingLink(input: string): ServerConnectionProfileImport {
  const url = new URL(input.trim());
  if (url.protocol !== `${MOBILE_PAIRING_SCHEME}:`) {
    throw new Error("Unsupported pairing link protocol.");
  }
  if (url.hostname !== MOBILE_PAIRING_HOST) {
    throw new Error("Unsupported pairing link destination.");
  }
  const payload = url.searchParams.get("payload")?.trim();
  if (!payload) {
    throw new Error("Pairing link payload is missing.");
  }
  return decodeServerConnectionProfileImport(payload);
}
