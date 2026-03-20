import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MODEL_OPTIONS_BY_PROVIDER, type ModelSlug, type ProviderKind } from "@t3tools/contracts";
import { colors, radii, spacing } from "../theme";

interface ProviderModelPickerProps {
  readonly visible: boolean;
  readonly provider: ProviderKind;
  readonly model: ModelSlug;
  readonly onSelect: (provider: ProviderKind, model: ModelSlug) => void;
  readonly onClose: () => void;
}

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

const AVAILABLE_PROVIDERS: ProviderKind[] = ["codex", "claudeAgent"];

export function ProviderModelPicker({
  visible,
  provider,
  model,
  onSelect,
  onClose,
}: ProviderModelPickerProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(provider);
  const models = useMemo(
    () => [...MODEL_OPTIONS_BY_PROVIDER[selectedProvider]],
    [selectedProvider],
  );

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Provider & Model</Text>

          <Text style={styles.sectionTitle}>Provider</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerRow}>
            {AVAILABLE_PROVIDERS.map((p) => {
              const isSelected = p === selectedProvider;
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${PROVIDER_LABELS[p]} provider`}
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.providerChip, isSelected && styles.providerChipSelected]}
                  onPress={() => setSelectedProvider(p)}
                >
                  <Text
                    style={[styles.providerChipText, isSelected && styles.providerChipTextSelected]}
                  >
                    {PROVIDER_LABELS[p]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionTitle}>Model</Text>
          <ScrollView style={styles.modelList}>
            {models.map((m) => {
              const isSelected = m.slug === model && selectedProvider === provider;
              return (
                <Pressable
                  key={m.slug}
                  accessibilityRole="button"
                  accessibilityLabel={`Select model ${m.name}`}
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.modelRow, isSelected && styles.modelRowSelected]}
                  onPress={() => {
                    onSelect(selectedProvider, m.slug);
                    onClose();
                  }}
                >
                  <Text style={[styles.modelName, isSelected && styles.modelNameSelected]}>
                    {m.name}
                  </Text>
                  <Text style={styles.modelSlug}>{m.slug}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    maxHeight: "70%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  providerRow: {
    flexGrow: 0,
    marginBottom: spacing.lg,
  },
  providerChip: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
  },
  providerChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.infoSurface,
  },
  providerChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  providerChipTextSelected: {
    color: colors.accent,
  },
  modelList: {
    flexGrow: 0,
    maxHeight: 300,
  },
  modelRow: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: 2,
  },
  modelRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.infoSurface,
  },
  modelName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  modelNameSelected: {
    color: colors.accent,
  },
  modelSlug: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
