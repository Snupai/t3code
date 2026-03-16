import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, radii, spacing } from "../../src/theme";
import { useMobileAppStore } from "../../src/mobileStore";

export default function ConnectScreen() {
  const router = useRouter();
  const profiles = useMobileAppStore((state) => state.profiles);
  const pendingImport = useMobileAppStore((state) => state.pendingImport);
  const upsertImportedProfile = useMobileAppStore((state) => state.upsertImportedProfile);
  const connectProfile = useMobileAppStore((state) => state.connectProfile);
  const connectionError = useMobileAppStore((state) => state.connectionError);
  const duplicateProfile = useMemo(
    () =>
      pendingImport
        ? (profiles.find((profile) => profile.serverUrl === pendingImport.serverUrl) ?? null)
        : null,
    [pendingImport, profiles],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.hero}>
          <Text style={styles.title}>T3 Code</Text>
          <Text style={styles.subtitle}>
            Connect to your desktop T3 Code server to monitor and control coding sessions from your
            phone.
          </Text>
        </Animated.View>

        {connectionError ? (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.errorCard}>
            <Text style={styles.errorTitle}>Connection failed</Text>
            <Text style={styles.errorText}>{connectionError}</Text>
          </Animated.View>
        ) : null}

        {pendingImport ? (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.importCard}>
            <Text style={styles.importTitle}>Pending pairing import</Text>
            <Text style={styles.importDetail}>{pendingImport.label}</Text>
            <Text style={styles.importDetail}>{pendingImport.serverUrl}</Text>
            {duplicateProfile && duplicateProfile.authToken !== pendingImport.authToken ? (
              <Text style={styles.warningText}>
                A saved profile already exists for this server. Confirming will replace its token.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save and connect to imported server"
              style={styles.primaryButton}
              onPress={() => {
                void upsertImportedProfile(pendingImport).then(() => {
                  router.replace("/");
                });
              }}
            >
              <Text style={styles.primaryButtonText}>
                {duplicateProfile ? "Replace token and connect" : "Save and connect"}
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan QR code from desktop"
            style={styles.primaryButton}
            onPress={() => router.push("/connect/scan")}
          >
            <Text style={styles.primaryButtonText}>Scan desktop QR</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Manually enter server details"
            style={styles.secondaryButton}
            onPress={() => router.push("/connect/manual")}
          >
            <Text style={styles.secondaryButtonText}>Enter server manually</Text>
          </Pressable>
        </Animated.View>

        {profiles.length > 0 ? (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
            <Text style={styles.sectionTitle}>SAVED SERVERS</Text>
            {profiles.map((profile) => (
              <Pressable
                key={profile.id}
                accessibilityRole="button"
                accessibilityLabel={`Connect to ${profile.label}`}
                style={styles.serverCard}
                onPress={() => {
                  void connectProfile(profile.id).then(() => {
                    router.replace("/");
                  });
                }}
              >
                <View style={styles.serverCardBody}>
                  <Text numberOfLines={1} style={styles.serverTitle}>
                    {profile.label}
                  </Text>
                  <Text numberOfLines={1} style={styles.serverSubtitle}>
                    {profile.serverUrl}
                  </Text>
                </View>
                <Text style={styles.connectAction}>Connect</Text>
              </Pressable>
            ))}
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  hero: {
    gap: spacing.sm,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  errorCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.dangerText,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.dangerText,
  },
  importCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  importTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  importDetail: {
    fontSize: 13,
    color: colors.textMuted,
  },
  warningText: {
    fontSize: 13,
    color: colors.warningText,
    lineHeight: 18,
  },
  actions: {
    gap: spacing.sm,
  },
  primaryButton: {
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primaryText,
  },
  secondaryButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSubtle,
    letterSpacing: 1,
    paddingLeft: spacing.xs,
  },
  serverCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  serverCardBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  serverTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  serverSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  connectAction: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
});
