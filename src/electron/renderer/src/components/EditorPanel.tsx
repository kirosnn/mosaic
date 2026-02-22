import React, { useMemo, useState } from "react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { X, Info } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { getMediaKind } from "../mediaPreview";
import type { FsEntry } from "../types";
import { FileTree } from "./FileTree";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rb: "ruby",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  dockerfile: "docker",
  vue: "markup",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
};

const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  ".env": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".gitignore": "git",
  ".gitattributes": "git",
};

function getCodeLanguage(filePath: string): string {
  if (!filePath) return "text";
  const normalized = filePath.replace(/\\/g, "/");
  const baseName = path.basename(normalized).toLowerCase();
  const byName = LANGUAGE_BY_FILENAME[baseName];
  if (byName) return byName;
  const ext = path.extname(baseName).slice(1);
  if (!ext) return "text";
  return LANGUAGE_BY_EXTENSION[ext] ?? "text";
}

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
  const codeLanguage = useMemo(() => getCodeLanguage(props.currentFile), [props.currentFile]);
  const activeTheme = document.documentElement.getAttribute("data-theme");
  const syntaxTheme = activeTheme === "light" ? oneLight : vscDarkPlus;

  const mediaSrc = useMemo(() => {
    if (!props.workspaceRoot || !props.currentFile || !mediaKind) return "";
    try {
      return pathToFileURL(path.resolve(props.workspaceRoot, props.currentFile)).href;
    } catch {
      return "";
    }
  }, [mediaKind, props.currentFile, props.workspaceRoot]);

  const displayText = props.editorValue ? props.editorValue : "";
  const highlightedSource = displayText.length > 0 ? displayText : " ";

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
                {React.createElement(
                  SyntaxHighlighter as any,
                  {
                    className: "code-preview-highlighter",
                    language: codeLanguage,
                    style: syntaxTheme,
                    showLineNumbers: true,
                    wrapLongLines: false,
                    wrapLines: true,
                    lineProps: () => ({ className: "code-preview-line" }),
                    customStyle: {
                      margin: 0,
                      padding: "16px",
                      minHeight: "100%",
                      whiteSpace: "pre",
                      background: "transparent",
                      fontFamily: "\"JetBrains Mono\", \"Consolas\", monospace",
                      fontSize: "13px",
                      lineHeight: "1.5",
                    },
                    lineNumberStyle: {
                      minWidth: "38px",
                      marginRight: "12px",
                      textAlign: "right",
                      color: "var(--editor-gutter-text)",
                      userSelect: "none",
                    },
                    codeTagProps: {
                      style: {
                        fontFamily: "\"JetBrains Mono\", \"Consolas\", monospace",
                      },
                    },
                  },
                  highlightedSource
                )}
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
