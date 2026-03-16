import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { toSortedCompat } from "@t3tools/shared/array";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { MobileDrawer } from "../../../src/components/MobileDrawer";
import { SkeletonThreadCard } from "../../../src/components/Skeleton";
import { StatusIndicator, resolveThreadStatus } from "../../../src/components/StatusIndicator";
import { GitStatusBadge } from "../../../src/components/GitStatusBadge";
import { formatRelativeTime } from "../../../src/lib/format";
import { derivePendingApprovals, derivePendingUserInputs } from "../../../src/lib/pendingRequests";
import { truncateTitle } from "../../../src/lib/ids";
import { colors, radii, spacing } from "../../../src/theme";
import { useMobileAppStore } from "../../../src/mobileStore";

export default function ProjectThreadsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string | string[] }>();
  const projectId = Array.isArray(params.projectId)
    ? (params.projectId[0] ?? "")
    : (params.projectId ?? "");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const readModel = useMobileAppStore((state) => state.readModel);
  const createThread = useMobileAppStore((state) => state.createThread);
  const rememberProject = useMobileAppStore((state) => state.rememberProject);
  const rememberThread = useMobileAppStore((state) => state.rememberThread);
  const refreshSnapshot = useMobileAppStore((state) => state.refreshSnapshot);
  const refreshing = useMobileAppStore((state) => state.refreshing);
  const deleteThread = useMobileAppStore((state) => state.deleteThread);
  const renameThread = useMobileAppStore((state) => state.renameThread);
  const fetchGitStatus = useMobileAppStore((state) => state.fetchGitStatus);
  const gitStatus = useMobileAppStore((state) => state.gitStatusByProjectId[projectId] ?? null);

  const project = readModel?.projects.find(
    (entry) => entry.id === projectId && entry.deletedAt === null,
  );
  const normalizedSearch = search.trim().toLowerCase();
  const threads = useMemo(
    () =>
      toSortedCompat(
        (readModel?.threads ?? []).filter(
          (thread) =>
            thread.projectId === projectId &&
            thread.deletedAt === null &&
            (normalizedSearch.length === 0 ||
              thread.title.toLowerCase().includes(normalizedSearch)),
        ),
        (left, right) => right.updatedAt.localeCompare(left.updatedAt),
      ),
    [normalizedSearch, projectId, readModel?.threads],
  );

  useEffect(() => {
    if (projectId) {
      void fetchGitStatus(projectId);
    }
  }, [fetchGitStatus, projectId]);

  const handleRefresh = useCallback(() => {
    void refreshSnapshot();
    if (projectId) {
      void fetchGitStatus(projectId);
    }
  }, [refreshSnapshot, fetchGitStatus, projectId]);

  if (!project) {
    return (
      <SafeAreaView edges={["top"]} style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>Project not found</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isLoading = !readModel;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <MobileDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          style={styles.headerButton}
          onPress={() => setDrawerOpen(true)}
        >
          <Text style={styles.headerButtonText}>Menu</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.title}>
            {project.title}
          </Text>
          <View style={styles.headerMeta}>
            <Text style={styles.subtitle}>
              {threads.length} {threads.length === 1 ? "thread" : "threads"}
            </Text>
            <GitStatusBadge status={gitStatus} />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create new thread"
          style={styles.primaryHeaderButton}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void createThread(project.id);
          }}
        >
          <Text style={styles.primaryHeaderButtonText}>+ New</Text>
        </Pressable>
      </View>

      <View style={styles.searchSection}>
        <TextInput
          accessibilityLabel="Search threads"
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search threads..."
          placeholderTextColor={colors.textSubtle}
          returnKeyType="search"
        />
      </View>

      {isLoading ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonThreadCard key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          data={threads}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>
                {normalizedSearch.length > 0 ? "No matching threads" : "No threads yet"}
              </Text>
              <Text style={styles.emptyStateText}>
                {normalizedSearch.length > 0
                  ? "Try a different search term."
                  : "Create a new thread to get started."}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const pendingApprovals = derivePendingApprovals(item.activities);
            const pendingUserInputs = derivePendingUserInputs(item.activities);
            const status = resolveThreadStatus(
              item.latestTurn?.state,
              pendingApprovals.length,
              pendingUserInputs.length,
            );
            const latestMessage = item.messages[item.messages.length - 1];

            return (
              <Animated.View entering={FadeInDown.delay(index * 30).duration(300)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Thread: ${item.title}`}
                  accessibilityHint="Tap to open, long press for options"
                  style={styles.threadCard}
                  onPress={() => {
                    void rememberProject(project.id);
                    void rememberThread(item.id);
                    void router.push(`/thread/${item.id}`);
                  }}
                  onLongPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    Alert.alert(truncateTitle(item.title, 40), "Choose an action", [
                      {
                        text: "Rename",
                        onPress: () => {
                          Alert.prompt(
                            "Rename thread",
                            undefined,
                            (newTitle) => {
                              if (newTitle) {
                                void renameThread(item.id, newTitle);
                              }
                            },
                            "plain-text",
                            item.title,
                          );
                        },
                      },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          Alert.alert("Delete thread?", "This action cannot be undone.", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => void deleteThread(item.id),
                            },
                          ]);
                        },
                      },
                      { text: "Cancel", style: "cancel" },
                    ]);
                  }}
                >
                  <View style={styles.threadCardHeader}>
                    <Text numberOfLines={1} style={styles.threadTitle}>
                      {item.title}
                    </Text>
                    <Text style={styles.threadTime}>{formatRelativeTime(item.updatedAt)}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.threadPreview}>
                    {latestMessage?.text || "No messages yet."}
                  </Text>
                  <StatusIndicator status={status} size="sm" />
                </Pressable>
              </Animated.View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  emptyScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  backButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerButton: {
    minWidth: 56,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  primaryHeaderButton: {
    minWidth: 64,
    height: 36,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  primaryHeaderButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryText,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  searchSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchInput: {
    height: 42,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  skeletonList: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  threadCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  threadCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  threadTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  threadTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  threadPreview: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    color: colors.textMuted,
  },
});
