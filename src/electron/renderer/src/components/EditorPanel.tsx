import React, { useMemo, useRef, useState } from "react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { X, Info } from "lucide-react";
import { getMediaKind } from "../mediaPreview";
import type { FsEntry } from "../types";
import { FileTree } from "./FileTree";

const CodeLineRenderer = ({ text }: { text: string }) => {
  const parts = text.split(/(<[^>]+>|"[^"]*"|^\s*\d+\.|\/\/.+)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("<") && part.endsWith(">")) {
          return <span key={i} className="syntax-tag">{part}</span>;
        } else if (part.startsWith('"') && part.endsWith('"')) {
          return <span key={i} className="syntax-string">{part}</span>;
        } else if (part.trim().startsWith("//")) {
          return <span key={i} className="syntax-comment">{part}</span>;
        } else if (part.includes("=")) {
          return <span key={i} className="syntax-attr">{part}</span>;
        }
        return part;
      })}
    </span>
  );
};

interface EditorPanelProps {
  currentFile: string;
  editorValue: string;
  workspaceRoot: string;
  directoryCache: Record<string, FsEntry[]>;
  openDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onCloseFile: () => void;
}

export function EditorPanel(props: EditorPanelProps) {
  const mediaKind = useMemo(() => getMediaKind(props.currentFile), [props.currentFile]);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLDivElement | null>(null);

  const mediaSrc = useMemo(() => {
    if (!props.workspaceRoot || !props.currentFile || !mediaKind) return "";
    try {
      return pathToFileURL(path.resolve(props.workspaceRoot, props.currentFile)).href;
    } catch {
      return "";
    }
  }, [mediaKind, props.currentFile, props.workspaceRoot]);

  const displayText = useMemo(() => {
    if (props.editorValue) return props.editorValue;
    return "";
  }, [props.currentFile, props.editorValue]);

  const textLines = useMemo(() => {
    const lines = displayText.split(/\r?\n/);
    return lines.length > 0 ? lines : [""];
  }, [displayText]);

  const fileName = props.currentFile ? path.basename(props.currentFile) : "";

  return (
    <section className="panel editor-panel">
      <div className={`editor-workbench ${explorerOpen ? "explorer-open" : "explorer-closed"}`}>
        <div className="editor-main-pane">
          <div className="editor-toolbar">
            {props.currentFile ? (
              <div className="editor-tab active">
                <Info size={13} className="tab-icon-info" />
                <span>{fileName}</span>
                <button
                  className="editor-tab-close-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCloseFile();
                  }}
                  aria-label="Close file"
                  title="Close file"
                >
                  <X size={13} className="tab-close" />
                </button>
              </div>
            ) : (
              <div className="editor-toolbar-spacer" />
            )}
          </div>

          <div className="editor-stage">
            {mediaKind === "image" && mediaSrc ? (
              <div className="media-preview">
                <img className="media-preview-image" src={mediaSrc} alt={props.currentFile || "Preview"} />
              </div>
            ) : mediaKind === "video" && mediaSrc ? (
              <div className="media-preview">
                <video className="media-preview-video" src={mediaSrc} controls preload="metadata" />
              </div>
            ) : props.currentFile ? (
              <div className="code-preview-shell">
                <div className="code-preview-gutter" ref={gutterRef}>
                  {textLines.map((_line, index) => (
                    <div key={`ln-${index + 1}`} className="code-preview-line-number">
                      {index + 1}
                    </div>
                  ))}
                </div>

                <div
                  className="code-preview-content"
                  ref={codeRef}
                  onScroll={(e) => {
                    if (gutterRef.current) {
                      gutterRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
                    }
                  }}
                >
                  {textLines.map((line, index) => (
                    <div key={index} className="code-line">
                      <CodeLineRenderer text={line} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className={`editor-explorer-pane ${explorerOpen ? "open" : "closed"}`} aria-hidden={!explorerOpen}>
          <div className="editor-toolbar editor-explorer-header">
            <div className="editor-tab active editor-explorer-tab">
              <span>Explorer</span>
            </div>
          </div>
          <div className="editor-explorer-content">
            <div className="editor-tree">
              <FileTree
                parentPath=""
                directoryCache={props.directoryCache}
                openDirectories={props.openDirectories}
                currentFile={props.currentFile}
                onToggleDirectory={props.onToggleDirectory}
                onOpenFile={props.onOpenFile}
              />
            </div>
          </div>
        </aside>
      </div>
      <button
        className="icon-btn sidebar-toggle-btn editor-explorer-toggle-floating"
        onClick={() => setExplorerOpen((prev) => !prev)}
        title={explorerOpen ? "Hide File Tree" : "Show File Tree"}
        aria-label={explorerOpen ? "Hide File Tree" : "Show File Tree"}
      >
        <svg data-slot="icon-svg" fill="none" aria-hidden="true" viewBox="0 0 20 20">
          <path d="M4.58203 16.6693L6.66536 9.58594H17.082M4.58203 16.6693H16.457L18.5404 9.58594H17.082M4.58203 16.6693H2.08203V3.33594H8.33203L9.9987 5.83594H17.082V9.58594" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"></path>
        </svg>
      </button>
    </section>
  );
}
