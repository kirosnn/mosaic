import React from "react";
import type { FsEntry } from "../types";
import { FileTree } from "./FileTree";

interface ExplorerPanelProps {
  directoryCache: Record<string, FsEntry[]>;
  openDirectories: Set<string>;
  currentFile: string;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  return (
    <aside className="panel explorer-panel">
      <div className="panel-head">
        <h2>Explorer</h2>
        <div className="panel-actions">
          <button className="tiny-button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      <div className="file-tree">
        <FileTree
          parentPath=""
          directoryCache={props.directoryCache}
          openDirectories={props.openDirectories}
          currentFile={props.currentFile}
          onToggleDirectory={props.onToggleDirectory}
          onOpenFile={props.onOpenFile}
        />
      </div>
    </aside>
  );
}
