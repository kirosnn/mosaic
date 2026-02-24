import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SidebarConversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: number;
}

interface SidebarProps {
  workspaceRoot: string;
  currentFile: string;
  themeLabel: string;
  conversations: SidebarConversation[];
  activeConversationId: string;
  isRunning: boolean;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onNewThread: () => void;
  onSelectConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function getRecencyLabel(updatedAt: number, now: number): "Today" | "Last week" | "Last month" | "Older" {
  const timestamp = Number.isFinite(updatedAt) ? updatedAt : 0;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  if (timestamp >= todayMs) {
    return "Today";
  }
  const ageMs = now - timestamp;
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
    return "Last week";
  }
  if (ageMs <= 30 * 24 * 60 * 60 * 1000) {
    return "Last month";
  }
  return "Older";
}

export function Sidebar(props: SidebarProps) {
  const [editingConversationId, setEditingConversationId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [openMenuConversationId, setOpenMenuConversationId] = useState("");
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const groupedConversations = useMemo(() => {
    const now = Date.now();
    const sorted = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const buckets = new Map<string, SidebarConversation[]>();
    for (const conversation of sorted) {
      const label = getRecencyLabel(conversation.updatedAt, now);
      const current = buckets.get(label) ?? [];
      current.push(conversation);
      buckets.set(label, current);
    }
    const order = ["Today", "Last week", "Last month", "Older"];
    return order
      .map((label) => ({ label, items: buckets.get(label) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [props.conversations]);

  const openMenuConversation = useMemo(
    () => props.conversations.find((conversation) => conversation.id === openMenuConversationId) ?? null,
    [props.conversations, openMenuConversationId],
  );

  const beginRename = (conversation: SidebarConversation) => {
    setOpenMenuConversationId("");
    setMenuPosition(null);
    setEditingConversationId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const submitRename = (conversationId: string) => {
    const nextTitle = editingTitle.trim();
    if (nextTitle) {
      props.onRenameConversation(conversationId, nextTitle);
    }
    setEditingConversationId("");
    setEditingTitle("");
  };

  const cancelRename = () => {
    setEditingConversationId("");
    setEditingTitle("");
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".sidebar-history-menu")) return;
      if (target.closest(".sidebar-history-menu-popover")) return;
      setOpenMenuConversationId("");
      setMenuPosition(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuConversationId("");
        setMenuPosition(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!props.isOpen) {
      setOpenMenuConversationId("");
      setMenuPosition(null);
    }
  }, [props.isOpen]);

  useEffect(() => {
    if (!openMenuConversationId) return;

    const updateMenuPosition = () => {
      const trigger = menuTriggerRefs.current[openMenuConversationId];
      if (!trigger) {
        setOpenMenuConversationId("");
        setMenuPosition(null);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.right,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [openMenuConversationId]);

  return (
    <aside className={`sidebar ${props.isOpen ? "open" : "closed"}`}>
      <div className="sidebar-header">
        {props.isOpen && (
          <button className="sidebar-primary" onClick={props.onNewThread} disabled={props.isRunning}>
            New thread
          </button>
        )}
        <button className="icon-btn sidebar-toggle-btn" onClick={props.onToggle} title="Toggle Sidebar">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
            <path d="M9 5.25V18.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {props.isOpen && (
        <div className="sidebar-top">
          <section className="sidebar-history-section">
            <div className="sidebar-history-list">
              {groupedConversations.map((group) => (
                <section key={group.label} className="sidebar-history-group">
                  <h3 className="sidebar-history-group-label">{group.label}</h3>
                  <div className="sidebar-history-group-items">
                    {group.items.map((conversation) => {
                      const isActive = conversation.id === props.activeConversationId;
                      const isEditing = editingConversationId === conversation.id;
                      return (
                        <div key={conversation.id} className={`sidebar-history-item ${isActive ? "active" : ""}`}>
                          {isEditing ? (
                            <input
                              className="sidebar-history-input"
                              value={editingTitle}
                              autoFocus
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onBlur={() => submitRename(conversation.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  submitRename(conversation.id);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                            />
                          ) : (
                            <button
                              className="sidebar-history-main"
                              onClick={() => {
                                setOpenMenuConversationId("");
                                setMenuPosition(null);
                                props.onSelectConversation(conversation.id);
                              }}
                              disabled={props.isRunning}
                            >
                              <span className="sidebar-history-title">{conversation.title}</span>
                            </button>
                          )}
                          <div className="sidebar-history-menu">
                            <button
                              ref={(element) => {
                                menuTriggerRefs.current[conversation.id] = element;
                              }}
                              className="sidebar-history-menu-trigger"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (openMenuConversationId === conversation.id) {
                                  setOpenMenuConversationId("");
                                  setMenuPosition(null);
                                  return;
                                }
                                const rect = event.currentTarget.getBoundingClientRect();
                                setOpenMenuConversationId(conversation.id);
                                setMenuPosition({
                                  top: rect.bottom + 6,
                                  left: rect.right,
                                });
                              }}
                              disabled={isEditing}
                              title="Conversation options"
                              aria-label="Conversation options"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
                                <circle cx="8" cy="3.25" r="1.25" />
                                <circle cx="8" cy="8" r="1.25" />
                                <circle cx="8" cy="12.75" r="1.25" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
      {props.isOpen && openMenuConversation && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              className="sidebar-history-menu-popover sidebar-history-menu-popover-floating"
              role="menu"
              aria-label="Conversation actions"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
            >
              <button
                className="sidebar-history-menu-item"
                onClick={() => beginRename(openMenuConversation)}
                disabled={props.isRunning || editingConversationId === openMenuConversation.id}
                role="menuitem"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M9.72821 2.87934C10.0318 2.10869 10.9028 1.72933 11.6735 2.03266L14.4655 3.13226C15.236 3.43593 15.6145 4.30697 15.3112 5.07758L11.3903 15.0307C11.2954 15.2717 11.1394 15.4835 10.9391 15.6459L10.8513 15.7123L7.7077 17.8979C7.29581 18.1843 6.73463 17.9917 6.57294 17.5356L6.54657 17.4409L5.737 13.6987C5.67447 13.4092 5.69977 13.107 5.80829 12.8315L9.72821 2.87934ZM6.73798 13.1987C6.70201 13.2903 6.69385 13.3906 6.71454 13.4868L7.44501 16.8627L10.28 14.892L10.3376 14.8452C10.3909 14.7949 10.4325 14.7332 10.4597 14.6645L13.0974 7.96723L9.37567 6.50141L6.73798 13.1987ZM11.3073 2.96332C11.0504 2.86217 10.7601 2.98864 10.6589 3.24555L9.74188 5.57074L13.4636 7.03754L14.3806 4.71137C14.4817 4.45445 14.3552 4.16413 14.0983 4.06293L11.3073 2.96332Z" />
                </svg>
                <span>Rename</span>
              </button>
              <button
                className="sidebar-history-menu-item danger"
                onClick={() => {
                  setOpenMenuConversationId("");
                  setMenuPosition(null);
                  props.onDeleteConversation(openMenuConversation.id);
                }}
                disabled={props.isRunning}
                role="menuitem"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M11.3232 1.5C11.9365 1.50011 12.4881 1.87396 12.7158 2.44336L13.3379 4H17.5L17.6006 4.00977C17.8285 4.0563 18 4.25829 18 4.5C18 4.7417 17.8285 4.94371 17.6006 4.99023L17.5 5H15.9629L15.0693 16.6152C15.0091 17.3965 14.3578 17.9999 13.5742 18H6.42578C5.6912 17.9999 5.07237 17.4697 4.94824 16.7598L4.93066 16.6152L4.03711 5H2.5C2.22387 5 2.00002 4.77613 2 4.5C2 4.22386 2.22386 4 2.5 4H6.66211L7.28418 2.44336L7.33105 2.33887C7.58152 1.82857 8.10177 1.5001 8.67676 1.5H11.3232ZM5.92773 16.5381C5.94778 16.7985 6.16464 16.9999 6.42578 17H13.5742C13.8354 16.9999 14.0522 16.7985 14.0723 16.5381L14.9609 5H5.03906L5.92773 16.5381ZM8.5 8C8.77613 8 8.99998 8.22388 9 8.5V13.5C9 13.7761 8.77614 14 8.5 14C8.22386 14 8 13.7761 8 13.5V8.5C8.00002 8.22388 8.22387 8 8.5 8ZM11.5 8C11.7761 8 12 8.22386 12 8.5V13.5C12 13.7761 11.7761 14 11.5 14C11.2239 14 11 13.7761 11 13.5V8.5C11 8.22386 11.2239 8 11.5 8ZM8.67676 2.5C8.49802 2.5001 8.33492 2.59525 8.24609 2.74609L8.21289 2.81445L7.73828 4H12.2617L11.7871 2.81445C11.7112 2.62471 11.5276 2.50011 11.3232 2.5H8.67676Z" />
                </svg>
                <span>Delete</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
