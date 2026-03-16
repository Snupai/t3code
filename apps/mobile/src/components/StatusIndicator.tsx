import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { ThreadStatus } from "../mobileTypes";
import { colors, spacing } from "../theme";

interface StatusIndicatorProps {
  readonly status: ThreadStatus;
  readonly showLabel?: boolean;
  readonly size?: "sm" | "md";
}

const STATUS_CONFIG: Record<
  ThreadStatus,
  { color: string; textColor: string; label: string; animate: boolean }
> = {
  running: {
    color: colors.success,
    textColor: colors.successText,
    label: "Running",
    animate: true,
  },
  error: {
    color: colors.danger,
    textColor: colors.dangerText,
    label: "Error",
    animate: false,
  },
  approval: {
    color: colors.warning,
    textColor: colors.warningText,
    label: "Approval",
    animate: true,
  },
  input: {
    color: colors.accent,
    textColor: colors.accent,
    label: "Input",
    animate: true,
  },
  idle: {
    color: colors.textSubtle,
    textColor: colors.textSubtle,
    label: "Idle",
    animate: false,
  },
};

export function StatusIndicator({ status, showLabel = true, size = "md" }: StatusIndicatorProps) {
  const config = STATUS_CONFIG[status];
  const opacity = useSharedValue(1);
  const dotSize = size === "sm" ? 6 : 8;

  useEffect(() => {
    if (config.animate) {
      opacity.value = withRepeat(withTiming(0.3, { duration: 800 }), -1, true);
    } else {
      opacity.value = 1;
    }
  }, [config.animate, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${config.label}`}
      style={styles.container}
    >
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: config.color,
          },
          animatedStyle,
        ]}
      />
      {showLabel ? (
        <Text style={[styles.label, { color: config.textColor }]}>{config.label}</Text>
      ) : null}
    </View>
  );
}

export function resolveThreadStatus(
  latestTurnState: string | undefined | null,
  pendingApprovalCount: number,
  pendingUserInputCount: number,
): ThreadStatus {
  if (latestTurnState === "running") return "running";
  if (latestTurnState === "error") return "error";
  if (pendingApprovalCount > 0) return "approval";
  if (pendingUserInputCount > 0) return "input";
  return "idle";
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {},
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
