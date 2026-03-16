import { StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";

import { colors } from "../theme";

interface MessageMarkdownProps {
  readonly children: string;
}

const markdownStyles = StyleSheet.create({
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 6,
  },
  heading3: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 4,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  code_inline: {
    color: colors.accent,
    backgroundColor: colors.codeBackground,
    borderColor: colors.codeBorder,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: "monospace",
    fontSize: 13,
  },
  fence: {
    backgroundColor: colors.codeBackground,
    borderColor: colors.codeBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  code_block: {
    backgroundColor: colors.codeBackground,
    borderColor: colors.codeBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontFamily: "monospace",
    fontSize: 13,
    color: colors.text,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  list_item: {
    marginVertical: 2,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  bullet_list_icon: {
    color: colors.textMuted,
    marginRight: 8,
  },
  ordered_list_icon: {
    color: colors.textMuted,
    marginRight: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: colors.surfaceMuted,
  },
  th: {
    color: colors.text,
    fontWeight: "600",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  td: {
    color: colors.text,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  link: {
    color: colors.accent,
    textDecorationLine: "underline",
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 12,
  },
  strong: {
    fontWeight: "700",
    color: colors.text,
  },
  em: {
    fontStyle: "italic",
    color: colors.text,
  },
  s: {
    textDecorationLine: "line-through",
    color: colors.textMuted,
  },
  image: {
    borderRadius: 8,
    marginVertical: 8,
  },
});

export function MessageMarkdown({ children }: MessageMarkdownProps) {
  return <Markdown style={markdownStyles}>{children}</Markdown>;
}
