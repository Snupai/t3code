export function createStableId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

export function inferProjectTitleFromPath(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim().replace(/[\\/]+$/, "");
  const lastSlashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const segment = lastSlashIndex >= 0 ? trimmed.slice(lastSlashIndex + 1) : trimmed;
  return segment.length > 0 ? segment : "Project";
}

export function truncateTitle(title: string, maxLength = 80): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) {
    return trimmed || "New thread";
  }
  return `${trimmed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
