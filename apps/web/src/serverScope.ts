import type { StateStorage } from "zustand/middleware";
import { readStoredAppSettings } from "./appSettings";
import {
  getDefaultServerProfileId,
  getServerConnectionScopeKey,
  resolveServerConnectionProfileById,
} from "./serverConnection";

function resolveInitialServerScopeKey(): string {
  const settings = readStoredAppSettings();
  const activeProfile =
    resolveServerConnectionProfileById(settings.serverProfiles, settings.activeServerProfileId) ??
    resolveServerConnectionProfileById(settings.serverProfiles, getDefaultServerProfileId());
  return activeProfile ? getServerConnectionScopeKey(activeProfile) : "server:unknown";
}

let currentServerScopeKey = resolveInitialServerScopeKey();

function readScopedRoot(baseStorage: StateStorage, key: string): Record<string, string> {
  const raw = baseStorage.getItem(key);
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeScopedRoot(
  baseStorage: StateStorage,
  key: string,
  value: Record<string, string>,
): void {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    baseStorage.removeItem(key);
    return;
  }
  baseStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
}

export function getCurrentServerScopeKey(): string {
  return currentServerScopeKey;
}

export function setCurrentServerScopeKey(scopeKey: string): void {
  currentServerScopeKey = scopeKey;
}

export function createServerScopedStorage(baseStorage: StateStorage): StateStorage {
  return {
    getItem: (name) => readScopedRoot(baseStorage, name)[currentServerScopeKey] ?? null,
    setItem: (name, value) => {
      const nextRoot = readScopedRoot(baseStorage, name);
      nextRoot[currentServerScopeKey] = value;
      writeScopedRoot(baseStorage, name, nextRoot);
    },
    removeItem: (name) => {
      const nextRoot = readScopedRoot(baseStorage, name);
      delete nextRoot[currentServerScopeKey];
      writeScopedRoot(baseStorage, name, nextRoot);
    },
  };
}

export function readServerScopedStorageItem(
  baseStorage: StateStorage,
  key: string,
  scopeKey = currentServerScopeKey,
): string | null {
  return readScopedRoot(baseStorage, key)[scopeKey] ?? null;
}
