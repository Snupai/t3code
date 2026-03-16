import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, radii } from "../theme";

interface SkeletonProps {
  readonly width?: number | `${number}%`;
  readonly height?: number;
  readonly borderRadius?: number;
  readonly style?: ViewStyle;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = radii.md,
  style,
}: SkeletonProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function SkeletonThreadCard() {
  return (
    <View style={skeletonStyles.threadCard}>
      <View style={skeletonStyles.row}>
        <Skeleton width="65%" height={18} />
        <Skeleton width={48} height={14} />
      </View>
      <Skeleton width="90%" height={14} />
      <Skeleton width="40%" height={14} />
      <View style={skeletonStyles.row}>
        <Skeleton width={60} height={14} />
      </View>
    </View>
  );
}

export function SkeletonMessageCard() {
  return (
    <View style={skeletonStyles.messageCard}>
      <Skeleton width={60} height={12} />
      <Skeleton width="95%" height={16} />
      <Skeleton width="80%" height={16} />
      <Skeleton width="60%" height={16} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  threadCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 10,
  },
  messageCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
});
