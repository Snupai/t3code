import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "../theme";

interface DiffFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
}

interface DiffViewProps {
  readonly files: readonly DiffFile[];
}

function DiffLine({ line }: { readonly line: string }) {
  const isAddition = line.startsWith("+") && !line.startsWith("+++");
  const isDeletion = line.startsWith("-") && !line.startsWith("---");
  const isHeader = line.startsWith("@@");

  const lineStyle = isAddition
    ? styles.additionLine
    : isDeletion
      ? styles.deletionLine
      : isHeader
        ? styles.headerLine
        : styles.contextLine;

  const textStyle = isAddition
    ? styles.additionText
    : isDeletion
      ? styles.deletionText
      : isHeader
        ? styles.headerText
        : styles.contextText;

  return (
    <View style={lineStyle}>
      <Text style={textStyle}>{line}</Text>
    </View>
  );
}

function DiffFileView({ file }: { readonly file: DiffFile }) {
  const lines = file.patch?.split("\n") ?? [];

  return (
    <View style={styles.fileCard}>
      <View style={styles.fileHeader}>
        <Text numberOfLines={1} style={styles.filePath}>
          {file.path}
        </Text>
        <View style={styles.statRow}>
          {file.additions > 0 ? <Text style={styles.addStat}>+{file.additions}</Text> : null}
          {file.deletions > 0 ? <Text style={styles.delStat}>-{file.deletions}</Text> : null}
        </View>
      </View>
      {lines.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.patchContent}>
            {lines.map((line, lineIndex) => (
              // Diff lines are positional and content may repeat; index key is acceptable here.
              // eslint-disable-next-line react/no-array-index-key
              <DiffLine key={lineIndex} line={line} />
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

export function DiffView({ files }: DiffViewProps) {
  if (files.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No changes in this turn.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </Text>
      </View>
      {files.map((file) => (
        <DiffFileView key={file.path} file={file} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  summary: {
    paddingBottom: spacing.sm,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  fileCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filePath: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "monospace",
    color: colors.text,
  },
  statRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  addStat: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.success,
  },
  delStat: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.danger,
  },
  patchContent: {
    padding: spacing.sm,
    minWidth: "100%",
  },
  additionLine: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  deletionLine: {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  headerLine: {
    backgroundColor: colors.infoSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  contextLine: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  additionText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: colors.successText,
  },
  deletionText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: colors.dangerText,
  },
  headerText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: colors.accent,
  },
  contextText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
