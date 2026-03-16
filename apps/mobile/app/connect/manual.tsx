import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { normalizeServerConnectionUrl } from "@t3tools/shared/connectionProfile";
import { colors, radii, spacing } from "../../src/theme";
import { useMobileAppStore } from "../../src/mobileStore";

export default function ManualConnectScreen() {
  const router = useRouter();
  const profiles = useMobileAppStore((state) => state.profiles);
  const upsertManualProfile = useMobileAppStore((state) => state.upsertManualProfile);
  const [label, setLabel] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeServerConnectionUrl(serverUrl), [serverUrl]);
  const duplicateProfile =
    normalized.ok && normalized.normalizedUrl
      ? (profiles.find((profile) => profile.serverUrl === normalized.normalizedUrl) ?? null)
      : null;

  const canSubmit = label.trim().length > 0 && serverUrl.trim().length > 0 && !submitting;

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
        <Text style={styles.headerTitle}>Manual Setup</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Enter the server details from the desktop app. The connection is validated before the
          profile is saved.
        </Text>

        <View style={styles.formCard}>
          <View style={styles.field}>
            <Text style={styles.label}>Profile label</Text>
            <TextInput
              accessibilityLabel="Profile label"
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="My Desktop"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Server URL</Text>
            <Text style={styles.fieldHint}>HTTP or WebSocket origin</Text>
            <TextInput
              accessibilityLabel="Server URL"
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://100.64.0.10:3773"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Auth token</Text>
            <TextInput
              accessibilityLabel="Authentication token"
              style={styles.input}
              value={authToken}
              onChangeText={setAuthToken}
              placeholder="Paste the desktop auth token"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>
        </View>

        {!normalized.ok && serverUrl.trim().length > 0 ? (
          <Text style={styles.errorText}>{normalized.error}</Text>
        ) : null}
        {duplicateProfile ? (
          <Text style={styles.warningText}>
            A saved profile already exists for this URL. Saving will update it.
          </Text>
        ) : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorCardTitle}>Connection failed</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save and connect"
          style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={() => {
            setSubmitting(true);
            setError(null);
            void upsertManualProfile({ label, serverUrl, authToken })
              .then(() => {
                router.replace("/");
              })
              .catch((cause) => {
                setError(
                  cause instanceof Error ? cause.message : "Unable to connect to the server.",
                );
              })
              .finally(() => {
                setSubmitting(false);
              });
          }}
        >
          <Text style={styles.primaryButtonText}>
            {submitting ? "Connecting..." : "Save and connect"}
          </Text>
        </Pressable>
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
    padding: spacing.xl,
    gap: spacing.lg,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  formCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  input: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerText,
    lineHeight: 18,
  },
  warningText: {
    fontSize: 13,
    color: colors.warningText,
    lineHeight: 18,
  },
  errorCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.dangerText,
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
  buttonDisabled: {
    opacity: 0.5,
  },
});
