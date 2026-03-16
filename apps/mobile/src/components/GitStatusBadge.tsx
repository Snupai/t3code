import { StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import type { GitStatusInfo } from "../mobileTypes";

interface GitStatusBadgeProps {
  readonly status: GitStatusInfo | null;
}

export function GitStatusBadge({ status }: GitStatusBadgeProps) {
  if (!status?.branch) {
    return null;
  }

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Git branch ${status.branch}`}
      style={styles.container}
    >
      <Text style={styles.branchIcon}>&#xE0A0;</Text>
      <Text numberOfLines={1} style={styles.branchName}>
        {status.branch}
      </Text>
      {status.isDirty ? <View style={styles.dirtyDot} /> : null}
      {status.ahead > 0 ? <Text style={styles.countBadge}>+{status.ahead}</Text> : null}
      {status.behind > 0 ? (
        <Text style={[styles.countBadge, styles.behindBadge]}>-{status.behind}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  branchIcon: {
    fontSize: 12,
    color: colors.textMuted,
  },
  branchName: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    maxWidth: 120,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  countBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.successText,
  },
  behindBadge: {
    color: colors.warningText,
  },
});
