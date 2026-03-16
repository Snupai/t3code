import { useCallback, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { buildServerAssetUrl } from "@t3tools/shared/connectionProfile";
import { MobileDrawer } from "../../src/components/MobileDrawer";
import { MessageMarkdown } from "../../src/components/MessageMarkdown";
import { StatusIndicator, resolveThreadStatus } from "../../src/components/StatusIndicator";
import { SkeletonMessageCard } from "../../src/components/Skeleton";
import { ProviderModelPicker } from "../../src/components/ProviderModelPicker";
import { showToast } from "../../src/components/Toast";
import { formatRelativeTime } from "../../src/lib/format";
import {
  buildPendingUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "../../src/lib/pendingRequests";
import { getComposerDraftForThread, useMobileAppStore } from "../../src/mobileStore";
import { colors, radii, spacing } from "../../src/theme";

export default function ThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const threadId = Array.isArray(params.threadId)
    ? (params.threadId[0] ?? "")
    : (params.threadId ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const readModel = useMobileAppStore((state) => state.readModel);
  const profiles = useMobileAppStore((state) => state.profiles);
  const activeProfileId = useMobileAppStore((state) => state.activeProfileId);
  const rememberThread = useMobileAppStore((state) => state.rememberThread);
  const setDraft = useMobileAppStore((state) => state.setDraft);
  const sendMessage = useMobileAppStore((state) => state.sendMessage);
  const interruptThread = useMobileAppStore((state) => state.interruptThread);
  const respondApproval = useMobileAppStore((state) => state.respondApproval);
  const pendingUserInputDraftsByThreadId = useMobileAppStore(
    (state) => state.pendingUserInputDraftsByThreadId,
  );
  const setPendingUserInputDraft = useMobileAppStore((state) => state.setPendingUserInputDraft);
  const respondUserInput = useMobileAppStore((state) => state.respondUserInput);
  const refreshSnapshot = useMobileAppStore((state) => state.refreshSnapshot);
  const refreshing = useMobileAppStore((state) => state.refreshing);
  const preferredProvider = useMobileAppStore((state) => state.preferredProvider);
  const preferredModel = useMobileAppStore((state) => state.preferredModel);
  const setPreferredProvider = useMobileAppStore((state) => state.setPreferredProvider);
  const setPreferredModel = useMobileAppStore((state) => state.setPreferredModel);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const thread = readModel?.threads.find(
    (entry) => entry.id === threadId && entry.deletedAt === null,
  );
  const project = readModel?.projects.find((entry) => entry.id === thread?.projectId);
  const composerDraft = getComposerDraftForThread(threadId);
  const pendingApprovals = useMemo(
    () => (thread ? derivePendingApprovals(thread.activities) : []),
    [thread],
  );
  const pendingUserInputs = useMemo(
    () => (thread ? derivePendingUserInputs(thread.activities) : []),
    [thread],
  );

  const threadStatus = useMemo(
    () =>
      thread
        ? resolveThreadStatus(
            thread.latestTurn?.state,
            pendingApprovals.length,
            pendingUserInputs.length,
          )
        : "idle",
    [thread, pendingApprovals.length, pendingUserInputs.length],
  );

  const isRunning = thread?.latestTurn?.state === "running";

  const handleRefresh = useCallback(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const handleSend = useCallback(() => {
    if (composerDraft.trim().length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void sendMessage(threadId, composerDraft);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }, [composerDraft, sendMessage, threadId]);

  if (!thread) {
    return (
      <SafeAreaView edges={["top"]} style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>Thread not found</Text>
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

  const userInputDrafts = pendingUserInputDraftsByThreadId[thread.id] ?? {};

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <MobileDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ProviderModelPicker
        visible={modelPickerOpen}
        provider={preferredProvider}
        model={preferredModel ?? ""}
        onSelect={(provider, model) => {
          void setPreferredProvider(provider);
          void setPreferredModel(model);
          showToast(`Switched to ${provider} / ${model}`, "info");
        }}
        onClose={() => setModelPickerOpen(false)}
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={() => {
            void rememberThread(thread.id);
            if (project) {
              router.replace(`/(drawer)/project/${project.id}`);
            } else {
              router.back();
            }
          }}
        >
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.title}>
            {thread.title}
          </Text>
          <View style={styles.headerMeta}>
            <StatusIndicator status={threadStatus} size="sm" />
            <Text style={styles.subtitle}>{project?.title ?? "Unknown"}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          style={styles.headerButton}
          onPress={() => setDrawerOpen(true)}
        >
          <Text style={styles.headerButtonText}>Menu</Text>
        </Pressable>
      </View>

      {/* Timeline */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.timeline}
          contentContainerStyle={styles.timelineContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
        >
          {!readModel ? (
            <View style={styles.skeletonList}>
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonMessageCard key={i} />
              ))}
            </View>
          ) : null}

          {thread.messages.map((message, index) => (
            <Animated.View
              key={message.id}
              entering={FadeInUp.delay(index * 20).duration(250)}
              style={[
                styles.messageCard,
                message.role === "user" ? styles.userMessageCard : styles.assistantMessageCard,
              ]}
            >
              <Text style={styles.messageRole}>{message.role}</Text>
              {message.text ? (
                message.role === "assistant" ? (
                  <MessageMarkdown>{message.text}</MessageMarkdown>
                ) : (
                  <Text style={styles.messageText}>{message.text}</Text>
                )
              ) : (
                <Text style={styles.emptyMessageText}>(empty message)</Text>
              )}
              {message.attachments?.map((attachment) => {
                const imageUrl =
                  activeProfile &&
                  buildServerAssetUrl(
                    activeProfile,
                    `/attachments/${encodeURIComponent(attachment.id)}`,
                  );
                return (
                  <View key={attachment.id} style={styles.attachmentCard}>
                    {imageUrl ? (
                      <Image
                        accessibilityLabel={`Attachment: ${attachment.name}`}
                        source={{ uri: imageUrl }}
                        style={styles.attachmentPreview}
                        resizeMode="cover"
                      />
                    ) : null}
                    <Text style={styles.attachmentText}>{attachment.name}</Text>
                  </View>
                );
              })}
            </Animated.View>
          ))}

          {thread.proposedPlans.map((plan) => (
            <Animated.View key={plan.id} entering={FadeInUp.duration(300)} style={styles.planCard}>
              <Text style={styles.planTitle}>Proposed plan</Text>
              <MessageMarkdown>{plan.planMarkdown}</MessageMarkdown>
            </Animated.View>
          ))}

          {thread.activities.length > 0 ? (
            <View style={styles.activitiesSection}>
              {thread.activities.map((activity) => (
                <View key={activity.id} style={styles.activityRow}>
                  <Text numberOfLines={2} style={styles.activityTitle}>
                    {activity.summary}
                  </Text>
                  <Text style={styles.activityMeta}>{formatRelativeTime(activity.createdAt)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Pending Approvals */}
          {pendingApprovals.map((approval) => (
            <Animated.View
              key={approval.requestId}
              entering={FadeInUp.duration(300)}
              style={styles.panel}
            >
              <View style={styles.panelHeader}>
                <View style={styles.panelDot} />
                <Text style={styles.panelTitle}>Approval required</Text>
              </View>
              <Text style={styles.panelText}>
                {approval.detail ?? `Pending ${approval.requestKind} approval.`}
              </Text>
              <View style={styles.inlineActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Approve"
                  style={styles.approveButton}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    void respondApproval(thread.id, approval.requestId, "accept");
                  }}
                >
                  <Text style={styles.approveButtonText}>Approve</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Decline"
                  style={styles.declineButton}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    void respondApproval(thread.id, approval.requestId, "decline");
                  }}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </Pressable>
              </View>
            </Animated.View>
          ))}

          {/* Pending User Inputs */}
          {pendingUserInputs.map((pendingInput) => {
            const answers = buildPendingUserInputAnswers(pendingInput.questions, userInputDrafts);
            return (
              <Animated.View
                key={pendingInput.requestId}
                entering={FadeInUp.duration(300)}
                style={styles.panel}
              >
                <View style={styles.panelHeader}>
                  <View style={[styles.panelDot, { backgroundColor: colors.accent }]} />
                  <Text style={styles.panelTitle}>Additional input required</Text>
                </View>
                {pendingInput.questions.map((question) => {
                  const answerDraft = userInputDrafts[question.id];
                  return (
                    <View key={question.id} style={styles.questionBlock}>
                      <Text style={styles.questionHeader}>{question.header}</Text>
                      <Text style={styles.panelText}>{question.question}</Text>
                      <View style={styles.optionRow}>
                        {question.options.map((option) => {
                          const selected = answerDraft?.selectedOptionLabel === option.label;
                          return (
                            <Pressable
                              key={option.label}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              style={[styles.optionButton, selected && styles.optionButtonSelected]}
                              onPress={() =>
                                setPendingUserInputDraft(thread.id, question.id, {
                                  selectedOptionLabel: option.label,
                                })
                              }
                            >
                              <Text
                                style={[
                                  styles.optionButtonText,
                                  selected && styles.optionButtonTextSelected,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <TextInput
                        accessibilityLabel={`Custom answer for ${question.header}`}
                        style={styles.answerInput}
                        value={answerDraft?.customAnswer ?? ""}
                        onChangeText={(value) =>
                          setPendingUserInputDraft(thread.id, question.id, {
                            customAnswer: value,
                          })
                        }
                        placeholder="Or enter a custom answer"
                        placeholderTextColor={colors.textSubtle}
                      />
                    </View>
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Submit answers"
                  style={[styles.approveButton, !answers && styles.buttonDisabled]}
                  disabled={!answers}
                  onPress={() => {
                    if (!answers) return;
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    void respondUserInput(thread.id, pendingInput.requestId, answers);
                  }}
                >
                  <Text style={styles.approveButtonText}>Submit answers</Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </ScrollView>

        {/* Composer */}
        <View style={styles.composer}>
          <View style={styles.composerRow}>
            <TextInput
              accessibilityLabel="Message input"
              style={styles.composerInput}
              multiline
              value={composerDraft}
              onChangeText={(value) => {
                void setDraft(thread.id, value);
              }}
              placeholder="Send a message..."
              placeholderTextColor={colors.textSubtle}
            />
          </View>
          <View style={styles.composerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select provider and model"
              style={styles.modelPickerButton}
              onPress={() => setModelPickerOpen(true)}
            >
              <Text numberOfLines={1} style={styles.modelPickerText}>
                {preferredProvider}
              </Text>
            </Pressable>
            <View style={styles.composerButtonRow}>
              {isRunning ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop running turn"
                  style={styles.stopButton}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    void interruptThread(thread.id, thread.latestTurn?.turnId);
                  }}
                >
                  <Text style={styles.stopButtonText}>Stop</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                style={[styles.sendButton, !composerDraft.trim() && styles.buttonDisabled]}
                disabled={!composerDraft.trim()}
                onPress={handleSend}
              >
                <Text style={styles.sendButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  emptyScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
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
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  timeline: {
    flex: 1,
  },
  timelineContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  skeletonList: {
    gap: spacing.sm,
  },
  messageCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  userMessageCard: {
    borderColor: "rgba(99, 102, 241, 0.2)",
    backgroundColor: colors.infoSurface,
  },
  assistantMessageCard: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  emptyMessageText: {
    fontSize: 14,
    color: colors.textSubtle,
    fontStyle: "italic",
  },
  attachmentCard: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  attachmentPreview: {
    width: "100%",
    height: 180,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
  },
  attachmentText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  planCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
    backgroundColor: colors.warningSurface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  planTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.warningText,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  activitiesSection: {
    gap: spacing.xs,
  },
  activityRow: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  activityTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  activityMeta: {
    fontSize: 11,
    color: colors.textSubtle,
  },
  panel: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
    backgroundColor: colors.warningSurface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  panelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  panelText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  inlineActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  approveButton: {
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  approveButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryText,
  },
  declineButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  declineButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.dangerText,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  questionBlock: {
    gap: spacing.xs,
  },
  questionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  optionButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.infoSurface,
  },
  optionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
  },
  optionButtonTextSelected: {
    color: colors.accent,
  },
  answerInput: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  composerRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: "top",
  },
  composerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modelPickerButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  modelPickerText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  composerButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stopButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  stopButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.dangerText,
  },
  sendButton: {
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  sendButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryText,
  },
});
