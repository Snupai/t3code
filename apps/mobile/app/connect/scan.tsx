import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";

import { parseMobilePairingLink } from "@t3tools/shared/mobilePairing";
import { colors, radii, spacing } from "../../src/theme";
import { useMobileAppStore } from "../../src/mobileStore";

export default function ScanConnectScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [pendingPayload, setPendingPayload] = useState<ReturnType<
    typeof parseMobilePairingLink
  > | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const upsertImportedProfile = useMobileAppStore((state) => state.upsertImportedProfile);

  if (!permission?.granted) {
    return (
      <SafeAreaView edges={["top"]} style={styles.permissionScreen}>
        <Text style={styles.title}>Camera access required</Text>
        <Text style={styles.subtitle}>
          Grant camera access to scan the desktop pairing QR code.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enable camera access"
          style={styles.primaryButton}
          onPress={() => void requestPermission()}
        >
          <Text style={styles.primaryButtonText}>Enable camera</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.secondaryButton}
          onPress={() => router.back()}
        >
          <Text style={styles.secondaryButtonText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.headerTitle}>Scan QR</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Point your camera at the QR code shown in the desktop T3 Code settings.
        </Text>

        <View style={styles.cameraFrame}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(result) => {
              if (pendingPayload) return;
              try {
                setPendingPayload(parseMobilePairingLink(result.data));
                setScanError(null);
              } catch (error) {
                setScanError(
                  error instanceof Error ? error.message : "Unsupported pairing QR payload.",
                );
              }
            }}
          />
          <View style={styles.cameraOverlay}>
            <View style={styles.scanFrame} />
          </View>
        </View>

        {scanError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{scanError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try scanning again"
              style={styles.secondaryButton}
              onPress={() => {
                setScanError(null);
                setPendingPayload(null);
              }}
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {pendingPayload ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>{pendingPayload.label}</Text>
            <Text style={styles.resultDetail}>{pendingPayload.serverUrl}</Text>
            <View style={styles.resultActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save and connect"
                style={styles.primaryButton}
                onPress={() => {
                  void upsertImportedProfile(pendingPayload).then(() => {
                    router.replace("/");
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Save and connect</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan different QR"
                style={styles.secondaryButton}
                onPress={() => setPendingPayload(null)}
              >
                <Text style={styles.secondaryButtonText}>Scan another</Text>
              </Pressable>
            </View>
          </View>
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
  permissionScreen: {
    flex: 1,
    padding: spacing.xl,
    gap: spacing.lg,
    justifyContent: "center",
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
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  cameraFrame: {
    height: 300,
    overflow: "hidden",
    borderRadius: radii["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radii.xl,
  },
  errorCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerText,
  },
  resultCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  resultDetail: {
    fontSize: 13,
    color: colors.textMuted,
  },
  resultActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
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
});
