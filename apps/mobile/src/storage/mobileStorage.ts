import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import type {
  MobilePersistedState,
  MobileServerProfile,
  NotificationSettings,
} from "../mobileTypes";
import { DEFAULT_NOTIFICATION_SETTINGS } from "../mobileTypes";
import type { ModelSlug, ProviderKind } from "@t3tools/contracts";

const MOBILE_STATE_STORAGE_KEY = "t3code:mobile:state:v2";
const LEGACY_MOBILE_STATE_STORAGE_KEY = "t3code:mobile:state:v1";
const PROFILE_TOKEN_KEY_PREFIX = "t3code.mobile.profile-token.";

interface PersistedStateRecord {
  readonly profiles: Array<Omit<MobileServerProfile, "authToken">>;
  readonly activeProfileId: string | null;
  readonly draftsByServerUrl: Record<string, Record<string, string>>;
  readonly lastOpenedProjectIdByServerUrl: Record<string, string>;
  readonly lastOpenedThreadIdByServerUrl: Record<string, string>;
  readonly notificationSettings?: NotificationSettings;
  readonly preferredProvider?: ProviderKind;
  readonly preferredModel?: ModelSlug | null;
}

function tokenStorageKey(profileId: string): string {
  const normalizedProfileId = profileId.replace(/[^0-9A-Za-z._-]/g, "_");
  return `${PROFILE_TOKEN_KEY_PREFIX}${normalizedProfileId}`;
}

function defaultState(): MobilePersistedState {
  return {
    profiles: [],
    activeProfileId: null,
    draftsByServerUrl: {},
    lastOpenedProjectIdByServerUrl: {},
    lastOpenedThreadIdByServerUrl: {},
    notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
    preferredProvider: "codex",
    preferredModel: null,
  };
}

export async function readPersistedMobileState(): Promise<MobilePersistedState> {
  let raw = await AsyncStorage.getItem(MOBILE_STATE_STORAGE_KEY);

  if (!raw) {
    raw = await AsyncStorage.getItem(LEGACY_MOBILE_STATE_STORAGE_KEY);
  }

  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStateRecord>;
    const profiles = await Promise.all(
      (parsed.profiles ?? []).map(async (profile) => {
        const authToken = (await SecureStore.getItemAsync(tokenStorageKey(profile.id))) ?? "";
        return {
          id: profile.id,
          label: profile.label,
          serverUrl: profile.serverUrl,
          authToken,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        };
      }),
    );

    return {
      profiles,
      activeProfileId: parsed.activeProfileId ?? null,
      draftsByServerUrl: parsed.draftsByServerUrl ?? {},
      lastOpenedProjectIdByServerUrl: parsed.lastOpenedProjectIdByServerUrl ?? {},
      lastOpenedThreadIdByServerUrl: parsed.lastOpenedThreadIdByServerUrl ?? {},
      notificationSettings: parsed.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS,
      preferredProvider: parsed.preferredProvider ?? "codex",
      preferredModel: parsed.preferredModel ?? null,
    };
  } catch {
    return defaultState();
  }
}

export async function writePersistedMobileState(
  state: MobilePersistedState,
  previousProfiles: readonly MobileServerProfile[] = [],
): Promise<void> {
  const previousProfileIds = new Set(previousProfiles.map((profile) => profile.id));
  const nextProfileIds = new Set(state.profiles.map((profile) => profile.id));

  await AsyncStorage.setItem(
    MOBILE_STATE_STORAGE_KEY,
    JSON.stringify({
      profiles: state.profiles.map(({ authToken: _authToken, ...profile }) => profile),
      activeProfileId: state.activeProfileId,
      draftsByServerUrl: state.draftsByServerUrl,
      lastOpenedProjectIdByServerUrl: state.lastOpenedProjectIdByServerUrl,
      lastOpenedThreadIdByServerUrl: state.lastOpenedThreadIdByServerUrl,
      notificationSettings: state.notificationSettings,
      preferredProvider: state.preferredProvider,
      preferredModel: state.preferredModel,
    } satisfies PersistedStateRecord),
  );

  await Promise.all(
    state.profiles.map((profile) =>
      SecureStore.setItemAsync(tokenStorageKey(profile.id), profile.authToken),
    ),
  );

  await Promise.all(
    [...previousProfileIds]
      .filter((profileId) => !nextProfileIds.has(profileId))
      .map((profileId) => SecureStore.deleteItemAsync(tokenStorageKey(profileId))),
  );
}
