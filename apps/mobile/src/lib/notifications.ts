import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { NotificationSettings } from "../mobileTypes";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type NotificationCategory = "approval" | "error" | "turn-completed" | "user-input";

const CHANNEL_CONFIG: Record<
  NotificationCategory,
  {
    name: string;
    importance: Notifications.AndroidImportance;
    settingsKey: keyof NotificationSettings;
  }
> = {
  approval: {
    name: "Approvals",
    importance: Notifications.AndroidImportance.HIGH,
    settingsKey: "approvals",
  },
  error: {
    name: "Errors",
    importance: Notifications.AndroidImportance.HIGH,
    settingsKey: "errors",
  },
  "turn-completed": {
    name: "Turn completions",
    importance: Notifications.AndroidImportance.DEFAULT,
    settingsKey: "turnCompletions",
  },
  "user-input": {
    name: "User input requests",
    importance: Notifications.AndroidImportance.HIGH,
    settingsKey: "userInputs",
  },
};

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  for (const [id, config] of Object.entries(CHANNEL_CONFIG)) {
    await Notifications.setNotificationChannelAsync(id, {
      name: config.name,
      importance: config.importance,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#6366f1",
    });
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function sendLocalNotification(
  category: NotificationCategory,
  title: string,
  body: string,
  settings: NotificationSettings,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!settings.enabled) {
    return;
  }

  const config = CHANNEL_CONFIG[category];
  if (!settings[config.settingsKey]) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      ...(Platform.OS === "android" ? { channelId: category } : {}),
    },
    trigger: null,
  });
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
