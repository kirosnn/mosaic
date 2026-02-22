import React from "react";

interface SidebarProps {
  workspaceRoot: string;
  currentFile: string;
  themeLabel: string;
  chatCount: number;
  isRunning: boolean;
  onOpenSettings: () => void;
  onPickWorkspace: () => void;
  onToggleTheme: () => void;
  onNewThread: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar(props: SidebarProps) {
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
          <button className="sidebar-link" onClick={props.onPickWorkspace}>
            Open workspace
          </button>
        </div>
      )}
    </aside>
  );
}
