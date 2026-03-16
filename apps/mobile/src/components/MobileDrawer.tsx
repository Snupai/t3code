import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { colors, radii, spacing } from "../theme";
import { useMobileAppStore } from "../mobileStore";

interface MobileDrawerProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function MobileDrawer({ visible, onClose }: MobileDrawerProps) {
  const router = useRouter();
  const profiles = useMobileAppStore((state) => state.profiles);
  const activeProfileId = useMobileAppStore((state) => state.activeProfileId);
  const connectionPhase = useMobileAppStore((state) => state.connectionPhase);
  const readModel = useMobileAppStore((state) => state.readModel);
  const connectProfile = useMobileAppStore((state) => state.connectProfile);
  const disconnect = useMobileAppStore((state) => state.disconnect);
  const createThread = useMobileAppStore((state) => state.createThread);
  const addProject = useMobileAppStore((state) => state.addProject);
  const rememberProject = useMobileAppStore((state) => state.rememberProject);
  const deleteProject = useMobileAppStore((state) => state.deleteProject);
  const renameProject = useMobileAppStore((state) => state.renameProject);
  const [projectPath, setProjectPath] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectTitle, setEditingProjectTitle] = useState("");
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  const visibleProjects = (readModel?.projects ?? []).filter(
    (project) => project.deletedAt === null,
  );

  const connectionStatusColor =
    connectionPhase === "ready"
      ? colors.success
      : connectionPhase === "connecting"
        ? colors.warning
        : connectionPhase === "failed"
          ? colors.danger
          : colors.textSubtle;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        style={styles.overlay}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close drawer"
          style={styles.backdrop}
          onPress={onClose}
        />
        <SafeAreaView edges={["top", "bottom"]} style={styles.drawer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerTitle}>T3 Code</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close drawer"
              style={styles.closeButton}
              onPress={onClose}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Active Server Card */}
            <View style={styles.serverCard}>
              <View style={styles.serverCardHeader}>
                <View style={[styles.connectionDot, { backgroundColor: connectionStatusColor }]} />
                <Text numberOfLines={1} style={styles.serverName}>
                  {activeProfile?.label ?? "No server connected"}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.serverUrl}>
                {activeProfile?.serverUrl ?? "Connect to start."}
              </Text>
            </View>

            {/* Servers */}
            {profiles.length > 1 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SERVERS</Text>
                <View style={styles.sectionCard}>
                  {profiles.map((profile) => {
                    const isActive = profile.id === activeProfileId;
                    return (
                      <Pressable
                        key={profile.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to ${profile.label}`}
                        style={styles.listRow}
                        onPress={() => {
                          if (!isActive) {
                            void connectProfile(profile.id);
                          }
                          onClose();
                        }}
                      >
                        <View style={styles.listRowBody}>
                          <Text numberOfLines={1} style={styles.listRowTitle}>
                            {profile.label}
                          </Text>
                          <Text numberOfLines={1} style={styles.listRowSubtitle}>
                            {profile.serverUrl}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.listRowAction,
                            isActive ? styles.listRowActionActive : null,
                          ]}
                        >
                          {isActive ? "Active" : "Switch"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Projects */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PROJECTS</Text>
              <View style={styles.sectionCard}>
                {visibleProjects.map((project) => {
                  const threads = (readModel?.threads ?? []).filter(
                    (t) => t.projectId === project.id && t.deletedAt === null,
                  );
                  const runningCount = threads.filter(
                    (t) => t.latestTurn?.state === "running",
                  ).length;
                  const isEditing = editingProjectId === project.id;

                  return (
                    <View key={project.id} style={styles.projectRow}>
                      {isEditing ? (
                        <View style={styles.editRow}>
                          <TextInput
                            autoFocus
                            style={styles.editInput}
                            value={editingProjectTitle}
                            onChangeText={setEditingProjectTitle}
                            onBlur={() => {
                              void renameProject(project.id, editingProjectTitle);
                              setEditingProjectId(null);
                            }}
                            onSubmitEditing={() => {
                              void renameProject(project.id, editingProjectTitle);
                              setEditingProjectId(null);
                            }}
                          />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open project ${project.title}`}
                          style={styles.projectRowBody}
                          onPress={() => {
                            void rememberProject(project.id);
                            onClose();
                            void router.push(`/(drawer)/project/${project.id}`);
                          }}
                          onLongPress={() => {
                            Alert.alert(project.title, "Choose an action", [
                              {
                                text: "Rename",
                                onPress: () => {
                                  setEditingProjectId(project.id);
                                  setEditingProjectTitle(project.title);
                                },
                              },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: () => void deleteProject(project.id),
                              },
                              { text: "Cancel", style: "cancel" },
                            ]);
                          }}
                        >
                          <Text numberOfLines={1} style={styles.listRowTitle}>
                            {project.title}
                          </Text>
                          <Text style={styles.listRowSubtitle}>
                            {threads.length} thread{threads.length !== 1 ? "s" : ""}
                            {runningCount > 0 ? ` · ${runningCount} running` : ""}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`New thread in ${project.title}`}
                        style={styles.inlineButton}
                        onPress={() => {
                          void createThread(project.id).then(() => {
                            void rememberProject(project.id);
                            onClose();
                            void router.push(`/(drawer)/project/${project.id}`);
                          });
                        }}
                      >
                        <Text style={styles.inlineButtonText}>+ New</Text>
                      </Pressable>
                    </View>
                  );
                })}
                {visibleProjects.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <Text style={styles.emptyRowText}>No projects yet</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Add project */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ADD PROJECT</Text>
              <View style={styles.sectionCard}>
                <TextInput
                  accessibilityLabel="Project path"
                  style={styles.input}
                  value={projectPath}
                  onChangeText={setProjectPath}
                  placeholder="/remote/path/to/project"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add project"
                  style={[styles.primaryButton, !projectPath.trim() && styles.buttonDisabled]}
                  disabled={!projectPath.trim()}
                  onPress={() => {
                    setAddingProject(true);
                    void addProject(projectPath).finally(() => {
                      setAddingProject(false);
                      setProjectPath("");
                    });
                  }}
                >
                  <Text style={styles.primaryButtonText}>
                    {addingProject ? "Adding..." : "Add project"}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Bottom actions */}
            <View style={styles.bottomActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add server"
                style={styles.secondaryButton}
                onPress={() => {
                  onClose();
                  void router.push("/connect");
                }}
              >
                <Text style={styles.secondaryButtonText}>Add server</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                style={styles.secondaryButton}
                onPress={() => {
                  onClose();
                  void router.push("/settings");
                }}
              >
                <Text style={styles.secondaryButtonText}>Settings</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnect from server"
                style={[styles.secondaryButton, styles.disconnectButton]}
                onPress={() => {
                  void disconnect();
                  onClose();
                  void router.replace("/connect");
                }}
              >
                <Text style={[styles.secondaryButtonText, styles.disconnectButtonText]}>
                  Disconnect
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  drawer: {
    width: 320,
    maxWidth: "88%",
    height: "100%",
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  closeButton: {
    minWidth: 56,
    height: 32,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  drawerContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  serverCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  serverCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  serverUrl: {
    fontSize: 12,
    color: colors.textMuted,
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
  sectionCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  listRowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  listRowSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  listRowAction: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  listRowActionActive: {
    color: colors.accent,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  editRow: {
    flex: 1,
  },
  editInput: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
  emptyRow: {
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyRowText: {
    fontSize: 13,
    color: colors.textSubtle,
  },
  input: {
    height: 44,
    margin: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  primaryButton: {
    height: 42,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primaryText,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  inlineButton: {
    minWidth: 52,
    height: 30,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  inlineButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
  },
  bottomActions: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  secondaryButton: {
    height: 42,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  disconnectButton: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  disconnectButtonText: {
    color: colors.danger,
  },
});
