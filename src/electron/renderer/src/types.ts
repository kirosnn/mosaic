export type Theme = "dark" | "light";

export type EntryType = "file" | "directory";

export interface FsEntry {
  name: string;
  relativePath: string;
  type: EntryType;
}

export interface WorkspaceResponse {
  workspaceRoot: string;
}

export interface WorkspacePickResponse extends WorkspaceResponse {
  changed: boolean;
}

export interface ReadFileResponse {
  relativePath: string;
  content: string;
  truncated?: boolean;
  totalBytes?: number;
  previewBytes?: number;
}

export interface EditorStatus {
  text: string;
  error: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "error";
  content: string;
  displayContent?: string;
  isError?: boolean;
  running?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}

export interface AgentEvent {
  type: string;
  content?: string;
  error?: string;
  source?: string;
  provider?: string;
  model?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

export interface ChatEventPayload {
  requestId: string;
  type: string;
  event?: AgentEvent;
  error?: string;
  source?: string;
  provider?: string;
  model?: string;
  cancelled?: boolean;
}

export interface FsChangedPayload {
  changes?: string[];
}

export interface FsWatchErrorPayload {
  error?: string;
}

export interface UserPreferences {
  theme: Theme;
  sidebarOpen: boolean;
  previewOpen: boolean;
  workspaceRoot: string;
  windowMode: "normal" | "maximized" | "fullscreen";
}

export interface UserPreferencesPatch {
  theme?: Theme;
  sidebarOpen?: boolean;
  previewOpen?: boolean;
}

export interface CommandCatalogCommand {
  name: string;
  description: string;
  usage?: string;
  aliases: string[];
}

export interface CommandCatalogSkill {
  id: string;
  title: string;
  description: string;
}

export interface CommandCatalogResponse {
  commands: CommandCatalogCommand[];
  skills: CommandCatalogSkill[];
}

export interface DesktopCommandContextMessage {
  role: "user" | "assistant" | "tool" | "slash";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}

export interface DesktopCommandContext {
  messages?: DesktopCommandContextMessage[];
  isProcessing?: boolean;
}

export interface DesktopCommandResult {
  success: boolean;
  content: string;
  shouldAddToHistory?: boolean;
  shouldClearMessages?: boolean;
  shouldCompactMessages?: boolean;
  compactMaxTokens?: number;
  errorBanner?: string;
  openUsageView?: boolean;
  usageReport?: UsageReport;
}

export interface DesktopConversationStep {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
  displayContent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
  timestamp: number;
}

export interface DesktopConversationHistory {
  id: string;
  timestamp: number;
  steps: DesktopConversationStep[];
  totalSteps: number;
  title?: string | null;
  workspace?: string | null;
  totalTokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  model?: string;
  provider?: string;
  titleEdited?: boolean;
}

export interface ConversationHistoryListResponse {
  conversations: DesktopConversationHistory[];
  lastConversationId: string | null;
}

export type UsageIntensity = 0 | 1 | 2 | 3 | 4;

export interface UsageTokenTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageDailyModelEntry extends UsageTokenTotals {
  provider: string;
  model: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageDailyEntry extends UsageTokenTotals {
  date: string;
  timestampMs: number;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
  intensity: UsageIntensity;
  models: UsageDailyModelEntry[];
}

export interface UsageModelEntry extends UsageTokenTotals {
  provider: string;
  model: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageProviderEntry extends UsageTokenTotals {
  provider: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageWorkspaceEntry extends UsageTokenTotals {
  workspace: string;
  conversations: number;
  costUsd: number;
  unknownCostConversations: number;
}

export interface UsageYearEntry {
  year: string;
  totalTokens: number;
  totalCostUsd: number;
  activeDays: number;
}

export interface UsageTotals extends UsageTokenTotals {
  conversations: number;
  activeDays: number;
  costUsd: number;
  pricedConversations: number;
  unpricedConversations: number;
}

export interface UsageReport {
  generatedAt: string;
  scope: {
    includeAllWorkspaces: boolean;
    workspace: string | null;
  };
  dateRange: {
    start: string | null;
    end: string | null;
  };
  totals: UsageTotals;
  years: UsageYearEntry[];
  daily: UsageDailyEntry[];
  models: UsageModelEntry[];
  providers: UsageProviderEntry[];
  workspaces: UsageWorkspaceEntry[];
}

export interface DesktopApi {
  getPlatform: () => string;
  setWindowTheme: (theme: Theme) => void;
  getPreferences: () => Promise<UserPreferences>;
  setPreferences: (patch: UserPreferencesPatch) => Promise<UserPreferences>;
  getUiConstants: () => Promise<{ topbarHeight: number; isDev?: boolean }>;
  getWorkspace: () => Promise<WorkspaceResponse>;
  pickWorkspace: () => Promise<WorkspacePickResponse>;
  setWorkspace: (workspaceRoot: string) => Promise<WorkspacePickResponse>;
  readDir: (relativePath: string) => Promise<FsEntry[]>;
  readFile: (relativePath: string) => Promise<ReadFileResponse>;
  startChat: (messages: Array<{
    role: string;
    content: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    success?: boolean;
  }>) => Promise<{ requestId: string }>;
  cancelChat: (requestId: string) => Promise<{ cancelled: boolean }>;
  getConversationHistory: () => Promise<ConversationHistoryListResponse>;
  saveConversationHistory: (conversation: DesktopConversationHistory) => Promise<{ ok: boolean }>;
  renameConversationHistory: (id: string, title: string) => Promise<{ ok: boolean }>;
  deleteConversationHistory: (id: string) => Promise<{ ok: boolean }>;
  getCommandCatalog: () => Promise<CommandCatalogResponse>;
  executeCommand: (input: string, context?: DesktopCommandContext) => Promise<DesktopCommandResult>;
  onChatEvent: (callback: (payload: ChatEventPayload) => void) => () => void;
  onWorkspaceChanged: (callback: (payload: WorkspaceResponse) => void) => () => void;
  onFsChanged: (callback: (payload: FsChangedPayload) => void) => () => void;
  onFsWatchError: (callback: (payload: FsWatchErrorPayload) => void) => () => void;
}

declare global {
  interface Window {
    mosaicDesktop: DesktopApi;
  }
}
