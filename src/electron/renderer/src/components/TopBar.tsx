import React from "react";

interface TopBarProps {
  platform: string;
  logoSrc: string;
  workspaceRoot: string;
  sidebarOpen?: boolean;
  previewOpen?: boolean;
  onOpenSettings: () => void;
  onToggleSidebar?: () => void;
  onTogglePreview: () => void;
}

export function TopBar(props: TopBarProps) {
  return (
    <header className={`topbar platform-${props.platform}`}>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={props.onTogglePreview} title="Toggle Preview Modal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" strokeWidth="2"><path stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg>
        </button>
        <button className="icon-btn" onClick={props.onOpenSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" strokeWidth="2"><path stroke="currentColor" d="M13.5 3h-3C9.408 5.913 8.024 6.711 4.956 6.201l-1.5 2.598c1.976 2.402 1.976 4 0 6.402l1.5 2.598c3.068-.51 4.452.288 5.544 3.201h3c1.092-2.913 2.476-3.711 5.544-3.2l1.5-2.599c-1.976-2.402-1.976-4 0-6.402l-1.5-2.598c-3.068.51-4.452-.288-5.544-3.201Z"></path><circle cx="12" cy="12" r="2.5" fill="currentColor"></circle></svg>
        </button>
      </div>
    </header>
  );
}
