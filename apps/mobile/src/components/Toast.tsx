import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeOut, SlideInUp } from "react-native-reanimated";

import { colors, radii, spacing } from "../theme";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly type: ToastType;
  readonly duration?: number;
}

const toastColors: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: {
    bg: colors.successSurface,
    border: colors.success,
    text: colors.successText,
  },
  error: {
    bg: colors.dangerSurface,
    border: colors.danger,
    text: colors.dangerText,
  },
  info: {
    bg: colors.infoSurface,
    border: colors.accent,
    text: colors.accent,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warning,
    text: colors.warningText,
  },
};

let globalToastHandler: ((item: Omit<ToastItem, "id">) => void) | null = null;

let toastIdCounter = 0;

export function showToast(message: string, type: ToastType = "info", duration = 3000): void {
  globalToastHandler?.({ message, type, duration });
}

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = `toast-${++toastIdCounter}`;
    setToasts((prev) => [...prev.slice(-4), { ...item, id }]);
    const duration = item.duration ?? 3000;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    globalToastHandler = addToast;
    return () => {
      globalToastHandler = null;
    };
  }, [addToast]);

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <View style={styles.root}>
      {children}
      <View pointerEvents="box-none" style={styles.container}>
        {toasts.map((toast) => {
          const c = toastColors[toast.type];
          return (
            <Animated.View
              key={toast.id}
              entering={SlideInUp.duration(250).withInitialValues({
                transform: [{ translateY: -40 }],
              })}
              exiting={FadeOut.duration(200)}
            >
              <Pressable
                accessibilityRole="alert"
                style={[styles.toast, { backgroundColor: c.bg, borderColor: c.border }]}
                onPress={() => dismissToast(toast.id)}
              >
                <Text style={[styles.toastText, { color: c.text }]}>{toast.message}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    position: "absolute",
    top: 60,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 9999,
    gap: spacing.sm,
  },
  toast: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
