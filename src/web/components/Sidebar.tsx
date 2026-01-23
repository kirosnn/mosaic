/** @jsxImportSource react */
import { Conversation } from '../storage';

export interface SidebarProps {
    isExpanded: boolean;
    onToggleExpand: () => void;
    onNavigateToNewChat: () => void;
    onOpenSettings: () => void;
    onOpenHelp: () => void;
    conversations?: Conversation[];
    currentConversationId?: string | null;
    onLoadConversation?: (id: string) => void;
    onDeleteConversation?: (id: string) => void;
}

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

export function Sidebar({
    isExpanded,
    onToggleExpand,
    onNavigateToNewChat,
    onOpenSettings,
    onOpenHelp,
    conversations = [],
    currentConversationId,
    onLoadConversation,
    onDeleteConversation
}: SidebarProps) {
    return (
        <div className={`sidebar ${isExpanded ? 'expanded' : ''}`}>
            <div className="sidebar-top">
                <button className="icon-btn" onClick={onToggleExpand} title={isExpanded ? "Collapse" : "Expand"}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    <span className="label">Collapse</span>
                </button>
                <button className="icon-btn" onClick={onNavigateToNewChat} title="New Chat">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span className="label">New Chat</span>
                </button>
            </div>

            {isExpanded && conversations.length > 0 && (
                <div className="sidebar-conversations">
                    <div className="conversations-header">Your chats</div>
                    <div className="conversations-list">
                        {conversations.map((conv) => (
                            <div
                                key={conv.id}
                                className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                                onClick={() => onLoadConversation?.(conv.id)}
                            >
                                <div className="conversation-info">
                                    <span className="conversation-title">
                                        {conv.title || 'New conversation'}
                                    </span>
                                    <span className="conversation-date">
                                        {formatDate(conv.updatedAt)}
                                    </span>
                                </div>
                                <button
                                    className="conversation-delete"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteConversation?.(conv.id);
                                    }}
                                    title="Delete"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="sidebar-bottom">
                <button className="icon-btn" onClick={onOpenSettings} title="Settings">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    <span className="label">Settings</span>
                </button>
                <button className="icon-btn" onClick={onOpenHelp} title="Help">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <span className="label">Help</span>
                </button>
            </div>
        </div>
    );
}
