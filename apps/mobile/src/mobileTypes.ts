import type {
  ApprovalRequestId,
  ModelSlug,
  OrchestrationReadModel,
  ProviderKind,
  ServerConfig,
  ThreadId,
  UserInputQuestion,
} from "@t3tools/contracts";

export interface MobileServerProfile {
  readonly id: string;
  readonly label: string;
  readonly serverUrl: string;
  readonly authToken: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MobileConnectionPhase = "idle" | "connecting" | "ready" | "failed";

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: "command" | "file-read" | "file-change";
  readonly createdAt: string;
  readonly detail?: string;
}

export interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
}

export interface MobileServerSnapshot {
  readonly readModel: OrchestrationReadModel | null;
  readonly serverConfig: ServerConfig | null;
}

export interface MobilePersistedState {
  readonly profiles: MobileServerProfile[];
  readonly activeProfileId: string | null;
  readonly draftsByServerUrl: Record<string, Record<string, string>>;
  readonly lastOpenedProjectIdByServerUrl: Record<string, string>;
  readonly lastOpenedThreadIdByServerUrl: Record<string, string>;
  readonly notificationSettings: NotificationSettings;
  readonly preferredProvider: ProviderKind;
  readonly preferredModel: ModelSlug | null;
}

export interface PendingUserInputDraftAnswer {
  readonly selectedOptionLabel?: string;
  readonly customAnswer?: string;
}

export type PendingUserInputDraftsByThreadId = Record<
  ThreadId,
  Record<string, PendingUserInputDraftAnswer>
>;

export interface NotificationSettings {
  readonly enabled: boolean;
  readonly approvals: boolean;
  readonly errors: boolean;
  readonly turnCompletions: boolean;
  readonly userInputs: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  approvals: true,
  errors: true,
  turnCompletions: false,
  userInputs: true,
};

export type ThreadStatus = "running" | "error" | "approval" | "input" | "idle";

export interface GitStatusInfo {
  readonly branch: string | null;
  readonly isDirty: boolean;
  readonly ahead: number;
  readonly behind: number;
}
