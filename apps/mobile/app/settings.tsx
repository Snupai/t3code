import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing } from "../src/theme";
import { useMobileAppStore } from "../src/mobileStore";

const APP_VERSION: string = require("../package.json").version;

export default function MobileSettingsScreen() {
  const router = useRouter();
  const profiles = useMobileAppStore((state) => state.profiles);
  const activeProfileId = useMobileAppStore((state) => state.activeProfileId);
  const connectionPhase = useMobileAppStore((state) => state.connectionPhase);
  const connectionError = useMobileAppStore((state) => state.connectionError);
  const connectProfile = useMobileAppStore((state) => state.connectProfile);
  const removeProfile = useMobileAppStore((state) => state.removeProfile);
  const notificationSettings = useMobileAppStore((state) => state.notificationSettings);
  const setNotificationSettings = useMobileAppStore((state) => state.setNotificationSettings);

  const connectionStatusColor =
    connectionPhase === "ready"
      ? colors.success
      : connectionPhase === "connecting"
        ? colors.warning
        : connectionPhase === "failed"
          ? colors.danger
          : colors.textSubtle;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={() => router.back()}
        >
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Diagnostics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DIAGNOSTICS</Text>
          <View style={styles.card}>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Connection</Text>
              <View style={styles.diagValue}>
                <View style={[styles.statusDot, { backgroundColor: connectionStatusColor }]} />
                <Text style={styles.diagValueText}>{connectionPhase}</Text>
              </View>
            </View>
            {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>App version</Text>
              <Text style={styles.diagValueText}>{APP_VERSION}</Text>
            </View>
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Enable notifications</Text>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel="Enable notifications"
                value={notificationSettings.enabled}
                onValueChange={(value) => void setNotificationSettings({ enabled: value })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelGroup}>
                <Text style={styles.switchLabel}>Approvals</Text>
                <Text style={styles.switchHint}>Notify when a thread needs approval</Text>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel="Approval notifications"
                value={notificationSettings.approvals}
                onValueChange={(value) => void setNotificationSettings({ approvals: value })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                disabled={!notificationSettings.enabled}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelGroup}>
                <Text style={styles.switchLabel}>Errors</Text>
                <Text style={styles.switchHint}>Notify when a thread encounters an error</Text>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel="Error notifications"
                value={notificationSettings.errors}
                onValueChange={(value) => void setNotificationSettings({ errors: value })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                disabled={!notificationSettings.enabled}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelGroup}>
                <Text style={styles.switchLabel}>User inputs</Text>
                <Text style={styles.switchHint}>Notify when a thread requests user input</Text>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel="User input notifications"
                value={notificationSettings.userInputs}
                onValueChange={(value) => void setNotificationSettings({ userInputs: value })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                disabled={!notificationSettings.enabled}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelGroup}>
                <Text style={styles.switchLabel}>Turn completions</Text>
                <Text style={styles.switchHint}>Notify when a turn finishes</Text>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel="Turn completion notifications"
                value={notificationSettings.turnCompletions}
                onValueChange={(value) => void setNotificationSettings({ turnCompletions: value })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                disabled={!notificationSettings.enabled}
              />
            </View>
          </View>
        </View>

        {/* Saved Servers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SAVED SERVERS</Text>
          {profiles.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No saved server profiles.</Text>
            </View>
          ) : (
            profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              return (
                <View key={profile.id} style={styles.profileCard}>
                  <View style={styles.profileHeader}>
                    <View style={styles.profileText}>
                      <Text style={styles.profileTitle}>{profile.label}</Text>
                      <Text style={styles.profileSubtitle}>{profile.serverUrl}</Text>
                    </View>
                    {isActive ? (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText}>Active</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.inlineActions}>
                    {!isActive ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Connect to ${profile.label}`}
                        style={styles.actionButton}
                        onPress={() => {
                          void connectProfile(profile.id);
                        }}
                      >
                        <Text style={styles.actionButtonText}>Connect</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${profile.label}`}
                      style={[styles.actionButton, styles.deleteActionButton]}
                      onPress={() => {
                        void removeProfile(profile.id);
                      }}
                    >
                      <Text style={[styles.actionButtonText, styles.deleteActionButtonText]}>
                        Remove
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  headerSpacer: {
    width: 56,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSubtle,
    letterSpacing: 1,
    paddingLeft: spacing.xs,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  diagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  diagLabel: {
    fontSize: 14,
    color: colors.text,
  },
  diagValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  diagValueText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSubtle,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  switchLabelGroup: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  switchHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  profileCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  profileText: {
    flex: 1,
    gap: spacing.xs,
  },
  profileTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  profileSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  activeBadge: {
    borderRadius: radii.sm,
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.successText,
  },
  inlineActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  deleteActionButton: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  deleteActionButtonText: {
    color: colors.danger,
  },
});
