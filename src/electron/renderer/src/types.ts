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
}

export interface EditorStatus {
  text: string;
  error: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
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
}

export interface DesktopApi {
  getPlatform: () => string;
  setWindowTheme: (theme: Theme) => void;
  getPreferences: () => Promise<UserPreferences>;
  setPreferences: (patch: UserPreferencesPatch) => Promise<UserPreferences>;
  getUiConstants: () => Promise<{ topbarHeight: number }>;
  getWorkspace: () => Promise<WorkspaceResponse>;
  pickWorkspace: () => Promise<WorkspacePickResponse>;
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
