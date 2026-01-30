/** @jsxImportSource react */
import { useState, useMemo } from 'react';
import { Conversation, formatWorkspace } from '../storage';

type TimePeriod = 'today' | 'yesterday' | 'previous7days' | 'previous30days' | 'older';

interface GroupedConversations {
    period: TimePeriod;
    label: string;
    conversations: Conversation[];
}

function getTimePeriod(timestamp: number): TimePeriod {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOf7DaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
    const startOf30DaysAgo = startOfToday - 30 * 24 * 60 * 60 * 1000;

    if (timestamp >= startOfToday) {
        return 'today';
    } else if (timestamp >= startOfYesterday) {
        return 'yesterday';
    } else if (timestamp >= startOf7DaysAgo) {
        return 'previous7days';
    } else if (timestamp >= startOf30DaysAgo) {
        return 'previous30days';
    } else {
        return 'older';
    }
}

const periodLabels: Record<TimePeriod, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    previous7days: 'Previous 7 days',
    previous30days: 'Previous 30 days',
    older: 'Older',
};

const periodOrder: TimePeriod[] = ['today', 'yesterday', 'previous7days', 'previous30days', 'older'];

function groupConversationsByPeriod(conversations: Conversation[]): GroupedConversations[] {
    const groups: Record<TimePeriod, Conversation[]> = {
        today: [],
        yesterday: [],
        previous7days: [],
        previous30days: [],
        older: [],
    };

    for (const conv of conversations) {
        const period = getTimePeriod(conv.updatedAt);
        groups[period].push(conv);
    }

    return periodOrder
        .filter(period => groups[period].length > 0)
        .map(period => ({
            period,
            label: periodLabels[period],
            conversations: groups[period],
        }));
}

export interface SidebarProps {
    isExpanded: boolean;
    onToggleExpand: () => void;
    onNavigateToNewChat: () => void;
    onNavigateHome?: () => void;
    onOpenSettings: () => void;
    onOpenHelp: () => void;
    conversations?: Conversation[];
    currentConversationId?: string | null;
    onLoadConversation?: (id: string) => void;
    onDeleteConversation?: (id: string) => void;
    onRenameConversation?: (id: string, newTitle: string) => void;
}

export function Sidebar({
    isExpanded,
    onToggleExpand,
    onNavigateToNewChat,
    onNavigateHome,
    onOpenSettings,
    onOpenHelp,
    conversations = [],
    currentConversationId,
    onLoadConversation,
    onDeleteConversation,
    onRenameConversation
}: SidebarProps) {
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editTargetId, setEditTargetId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeleteTargetId(id);
        setDeleteModalOpen(true);
    };

    const handleConfirmDelete = () => {
        if (deleteTargetId) {
            onDeleteConversation?.(deleteTargetId);
        }
        setDeleteModalOpen(false);
        setDeleteTargetId(null);
    };

    const handleCancelDelete = () => {
        setDeleteModalOpen(false);
        setDeleteTargetId(null);
    };

    const handleEditClick = (e: React.MouseEvent, conv: Conversation) => {
        e.stopPropagation();
        setEditTargetId(conv.id);
        setEditTitle(conv.title || '');
        setEditModalOpen(true);
    };

    const handleConfirmEdit = () => {
        if (editTargetId && editTitle.trim()) {
            onRenameConversation?.(editTargetId, editTitle.trim());
        }
        setEditModalOpen(false);
        setEditTargetId(null);
        setEditTitle('');
    };

    const handleCancelEdit = () => {
        setEditModalOpen(false);
        setEditTargetId(null);
        setEditTitle('');
    };

    const handleEditKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConfirmEdit();
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    };

    const groupedConversations = useMemo(
        () => groupConversationsByPeriod(conversations),
        [conversations]
    );

    return (
        <>
            <div className={`sidebar ${isExpanded ? 'expanded' : ''}`}>
                <div className="sidebar-top">
                    <button className="icon-btn" onClick={onToggleExpand} title={isExpanded ? "Collapse" : "Expand"}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                        <span className="label">Collapse</span>
                    </button>
                    <button className="icon-btn" onClick={onNavigateHome} title="Home">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                        <span className="label">Home</span>
                    </button>
                    <button className="icon-btn" onClick={onNavigateToNewChat} title="New Chat">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span className="label">New Chat</span>
                    </button>
                </div>

                {isExpanded && conversations.length > 0 && (
                    <div className="sidebar-conversations">
                        <div className="conversations-list">
                            {groupedConversations.map((group) => (
                                <div key={group.period} className="conversation-group">
                                    <div className="conversation-group-header">{group.label}</div>
                                    {group.conversations.map((conv) => (
                                        <div
                                            key={conv.id}
                                            className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                                            onClick={() => onLoadConversation?.(conv.id)}
                                        >
                                            <div className="conversation-info">
                                                <span className="conversation-title">
                                                    {conv.title || 'New conversation'}
                                                </span>
                                                {conv.workspace && (
                                                    <span className="conversation-workspace" title={conv.workspace}>
                                                        {formatWorkspace(conv.workspace)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="conversation-actions">
                                                <button
                                                    className="conversation-action-btn conversation-edit"
                                                    onClick={(e) => handleEditClick(e, conv)}
                                                    title="Rename"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                    </svg>
                                                </button>
                                                <button
                                                    className="conversation-action-btn conversation-delete"
                                                    onClick={(e) => handleDeleteClick(e, conv.id)}
                                                    title="Delete"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="3 6 5 6 21 6"></polyline>
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
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

            {deleteModalOpen && (
                <div className="sidebar-modal-overlay" onClick={handleCancelDelete}>
                    <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="sidebar-modal-header">
                            <h3>Delete conversation</h3>
                        </div>
                        <div className="sidebar-modal-body">
                            <p>Are you sure you want to delete this conversation? This action cannot be undone.</p>
                        </div>
                        <div className="sidebar-modal-actions">
                            <button className="sidebar-modal-btn cancel" onClick={handleCancelDelete}>
                                Cancel
                            </button>
                            <button className="sidebar-modal-btn delete" onClick={handleConfirmDelete}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editModalOpen && (
                <div className="sidebar-modal-overlay" onClick={handleCancelEdit}>
                    <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="sidebar-modal-header">
                            <h3>Rename conversation</h3>
                        </div>
                        <div className="sidebar-modal-body">
                            <input
                                type="text"
                                className="sidebar-modal-input"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={handleEditKeyDown}
                                placeholder="Conversation title"
                                autoFocus
                            />
                        </div>
                        <div className="sidebar-modal-actions">
                            <button className="sidebar-modal-btn cancel" onClick={handleCancelEdit}>
                                Cancel
                            </button>
                            <button
                                className="sidebar-modal-btn confirm"
                                onClick={handleConfirmEdit}
                                disabled={!editTitle.trim()}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}