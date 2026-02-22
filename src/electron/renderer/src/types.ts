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
