import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { X, Info } from "lucide-react";
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
const MAX_HIGHLIGHT_BYTES = 320 * 1024;
const MAX_HIGHLIGHT_LINES = 6000;

interface SyntaxBundle {
  component: React.ComponentType<any>;
  lightStyle: Record<string, unknown>;
  darkStyle: Record<string, unknown>;
}

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

export interface HighlightedCodeSelection {
  lineNumbers: number[];
}

interface EditorPanelProps {
  currentFile: string;
  editorValue: string;
  logoSrc: string;
  workspaceRoot: string;
  directoryCache: Record<string, FsEntry[]>;
  openDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onCloseFile: () => void;
  onHighlightedCodeChange: (selection: HighlightedCodeSelection) => void;
}

function EditorPanelComponent(props: EditorPanelProps) {
  const mediaKind = useMemo(() => getMediaKind(props.currentFile), [props.currentFile]);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [syntaxBundle, setSyntaxBundle] = useState<SyntaxBundle | null>(null);
  const [syntaxLoadFailed, setSyntaxLoadFailed] = useState(false);
  const highlightedLinesRef = useRef<Set<number>>(new Set());
  const codeLanguage = useMemo(() => getCodeLanguage(props.currentFile), [props.currentFile]);
  const activeTheme = document.documentElement.getAttribute("data-theme");
  const syntaxTheme = activeTheme === "light" ? syntaxBundle?.lightStyle : syntaxBundle?.darkStyle;

  useEffect(() => {
    highlightedLinesRef.current = new Set();
    props.onHighlightedCodeChange({ lineNumbers: [] });
  }, [props.currentFile, props.onHighlightedCodeChange]);

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
  const plainTextFallback = useMemo(() => {
    const lineCount = displayText ? displayText.split(/\r?\n/).length : 0;
    const byteLength = new TextEncoder().encode(displayText).length;
    return byteLength > MAX_HIGHLIGHT_BYTES || lineCount > MAX_HIGHLIGHT_LINES;
  }, [displayText]);
  const needsSyntaxHighlighter = Boolean(props.currentFile) && !mediaKind && !plainTextFallback;

  useEffect(() => {
    if (!needsSyntaxHighlighter || syntaxBundle || syntaxLoadFailed) return;
    let cancelled = false;

    void Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/cjs/styles/prism"),
    ])
      .then(([highlighterModule, stylesModule]) => {
        if (cancelled) return;

        const component =
          (highlighterModule as { Prism?: unknown }).Prism ||
          (highlighterModule as { default?: { Prism?: unknown } }).default?.Prism ||
          (highlighterModule as { default?: unknown }).default;
        const lightStyle =
          (stylesModule as { oneLight?: Record<string, unknown> }).oneLight ||
          (stylesModule as { default?: { oneLight?: Record<string, unknown> } }).default?.oneLight;
        const darkStyle =
          (stylesModule as { vscDarkPlus?: Record<string, unknown> }).vscDarkPlus ||
          (stylesModule as { default?: { vscDarkPlus?: Record<string, unknown> } }).default?.vscDarkPlus;

        if (typeof component !== "function" || !lightStyle || !darkStyle) {
          setSyntaxLoadFailed(true);
          return;
        }

        setSyntaxBundle({
          component: component as React.ComponentType<any>,
          lightStyle,
          darkStyle,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSyntaxLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [needsSyntaxHighlighter, syntaxBundle, syntaxLoadFailed]);

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
                {plainTextFallback || !syntaxBundle || !syntaxTheme ? (
                  <pre className="code-preview-plain">{displayText || " "}</pre>
                ) : (
                  React.createElement(
                    syntaxBundle.component as any,
                    {
                      className: "code-preview-highlighter",
                      language: codeLanguage,
                      style: syntaxTheme,
                      showLineNumbers: true,
                      wrapLongLines: false,
                      wrapLines: true,
                      lineProps: (lineNumber: number) => ({
                        className: highlightedLinesRef.current.has(lineNumber)
                          ? "code-preview-line code-preview-line-highlighted"
                          : "code-preview-line",
                        onClick: (event: React.MouseEvent<HTMLElement>) => {
                          const next = highlightedLinesRef.current;
                          const isHighlighted = next.has(lineNumber);
                          if (isHighlighted) {
                            next.delete(lineNumber);
                          } else {
                            next.add(lineNumber);
                          }
                          event.currentTarget.classList.toggle("code-preview-line-highlighted", !isHighlighted);
                          props.onHighlightedCodeChange({
                            lineNumbers: Array.from(next).sort((a, b) => a - b),
                          });
                        },
                      }),
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
                  )
                )}
              </div>
            ) : (
              <div className="editor-empty-state">
                <img className="editor-empty-logo" src={props.logoSrc} alt="Mosaic logo" />
                <p>No file is open.</p>
              </div>
            )}
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

export const EditorPanel = memo(EditorPanelComponent);
