import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../src/theme";
import { setMobileRuntimeForegroundState, useMobileAppStore } from "../src/mobileStore";
import { ToastProvider } from "../src/components/Toast";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import {
  addNotificationResponseListener,
  requestNotificationPermissions,
  setupNotificationChannels,
} from "../src/lib/notifications";

const STATUS_BAR_PROPS = { style: "light" as const };

function MobileAppBootstrap() {
  const hydrate = useMobileAppStore((state) => state.hydrate);
  const loaded = useMobileAppStore((state) => state.loaded);
  const importPairingLink = useMobileAppStore((state) => state.importPairingLink);
  const router = useRouter();
  const pathname = usePathname();
  const hydratedRef = useRef(false);
  const notificationsSetupRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (notificationsSetupRef.current) {
      return;
    }
    notificationsSetupRef.current = true;
    void setupNotificationChannels();
    void requestNotificationPermissions();
  }, []);

  useEffect(() => {
    const subscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      const threadId = data?.threadId;
      if (typeof threadId === "string" && threadId.length > 0) {
        router.push(`/thread/${threadId}`);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (!url) return;
      void importPairingLink(url).then(() => {
        if (pathname !== "/connect") {
          router.replace("/connect");
        }
      });
    });

    const subscription = Linking.addEventListener("url", (event) => {
      void importPairingLink(event.url).then(() => {
        if (pathname !== "/connect") {
          router.replace("/connect");
        }
      });
    });

    return () => {
      subscription.remove();
    };
  }, [importPairingLink, pathname, router]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setMobileRuntimeForegroundState(state === "active");
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (!loaded) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar {...STATUS_BAR_PROPS} />
      <ErrorBoundary>
        <ToastProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="connect/index" />
            <Stack.Screen name="connect/manual" />
            <Stack.Screen name="connect/scan" />
            <Stack.Screen name="(drawer)/project/[projectId]" />
            <Stack.Screen name="thread/[threadId]" />
            <Stack.Screen name="settings" />
          </Stack>
        </ToastProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return <MobileAppBootstrap />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
