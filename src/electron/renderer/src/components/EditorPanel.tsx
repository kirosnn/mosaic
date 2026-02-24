import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const MAX_RENDER_CHARS = 220 * 1024;
const MAX_INTERACTIVE_LINE_SELECTION_CHARS = 90 * 1024;
const MAX_INTERACTIVE_LINE_SELECTION_LINES = 1800;
const MAX_SYNTAX_RENDER_CHARS = 60 * 1024;
const MAX_SYNTAX_RENDER_LINES = 1400;
const CODE_VIRTUAL_ROW_HEIGHT = 20;
const CODE_VIRTUAL_OVERSCAN_ROWS = 24;
const CODE_PREVIEW_CUSTOM_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "16px",
  minHeight: "100%",
  whiteSpace: "pre",
  background: "transparent",
  fontFamily: "var(--font-code)",
  fontSize: "13px",
  lineHeight: "1.5",
};
const CODE_PREVIEW_LINE_NUMBER_STYLE: React.CSSProperties = {
  minWidth: "38px",
  marginRight: "12px",
  textAlign: "right",
  color: "var(--editor-gutter-text)",
  userSelect: "none",
};
const CODE_PREVIEW_CODE_TAG_PROPS = {
  style: {
    fontFamily: "var(--font-code)",
  },
};

interface SyntaxBundle {
  component: React.ComponentType<any>;
  lightStyle: Record<string, unknown>;
  darkStyle: Record<string, unknown>;
}

interface VirtualCodeViewProps {
  content: string;
  interactive: boolean;
  highlightedLinesRef: React.MutableRefObject<Set<number>>;
  onHighlightedCodeChange: (selection: HighlightedCodeSelection) => void;
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

function shouldUsePlainTextFallback(content: string): boolean {
  if (!content) return false;
  let bytes = 0;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 10) {
      lines += 1;
    }

    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < content.length) {
      const next = content.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > MAX_HIGHLIGHT_BYTES || lines > MAX_HIGHLIGHT_LINES) {
      return true;
    }
  }
  return false;
}

function buildRenderableCode(content: string): string {
  if (!content || content.length <= MAX_RENDER_CHARS) {
    return content;
  }
  const clippedContent = content.slice(0, MAX_RENDER_CHARS);
  return `${clippedContent}\n\n[Preview clipped for performance]`;
}

function countLinesWithinLimit(content: string, limit: number): number {
  if (!content) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
      if (lines > limit) return lines;
    }
  }
  return lines;
}

const VirtualCodeView = memo(function VirtualCodeView(props: VirtualCodeViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [highlightVersion, setHighlightVersion] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);

  const lines = useMemo(() => props.content.split(/\r?\n/), [props.content]);
  const totalHeight = lines.length * CODE_VIRTUAL_ROW_HEIGHT;

  const refreshViewport = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const nextTop = node.scrollTop;
    const nextHeight = node.clientHeight;
    setScrollTop((prev) => (Math.abs(prev - nextTop) < 1 ? prev : nextTop));
    setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const onScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      refreshViewport();
    });
  }, [refreshViewport]);

  useEffect(() => {
    refreshViewport();
  }, [refreshViewport]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      refreshViewport();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [refreshViewport]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  const visibleRange = useMemo(() => {
    if (lines.length === 0) return { start: 0, end: 0 };
    if (viewportHeight <= 0) {
      return {
        start: Math.max(0, lines.length - 160),
        end: lines.length,
      };
    }
    const start = Math.max(0, Math.floor(scrollTop / CODE_VIRTUAL_ROW_HEIGHT) - CODE_VIRTUAL_OVERSCAN_ROWS);
    const end = Math.min(
      lines.length,
      Math.ceil((scrollTop + viewportHeight) / CODE_VIRTUAL_ROW_HEIGHT) + CODE_VIRTUAL_OVERSCAN_ROWS,
    );
    return { start, end };
  }, [lines.length, scrollTop, viewportHeight]);

  const toggleLine = useCallback((lineNumber: number) => {
    if (!props.interactive) return;
    const selected = props.highlightedLinesRef.current;
    if (selected.has(lineNumber)) {
      selected.delete(lineNumber);
    } else {
      selected.add(lineNumber);
    }
    props.onHighlightedCodeChange({
      lineNumbers: Array.from(selected).sort((a, b) => a - b),
    });
    setHighlightVersion((prev) => prev + 1);
  }, [props.highlightedLinesRef, props.interactive, props.onHighlightedCodeChange]);

  void highlightVersion;

  return (
    <div className={`code-virtual-viewport ${props.interactive ? "interactive" : "non-interactive"}`} ref={viewportRef} onScroll={onScroll}>
      <div className="code-virtual-list" style={{ height: `${totalHeight}px` }}>
        {lines.slice(visibleRange.start, visibleRange.end).map((lineText, index) => {
          const lineNumber = visibleRange.start + index + 1;
          const selected = props.highlightedLinesRef.current.has(lineNumber);
          return (
            <div
              key={lineNumber}
              className={`code-virtual-row ${selected ? "selected" : ""}`}
              style={{ transform: `translateY(${(lineNumber - 1) * CODE_VIRTUAL_ROW_HEIGHT}px)` }}
              onClick={() => toggleLine(lineNumber)}
            >
              <span className="code-virtual-line-number">{lineNumber}</span>
              <span className="code-virtual-line-content">{lineText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

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
  const renderableCode = useMemo(() => buildRenderableCode(displayText), [displayText]);
  const highlightedSource = renderableCode.length > 0 ? renderableCode : " ";
  const plainTextFallback = useMemo(() => shouldUsePlainTextFallback(renderableCode), [renderableCode]);
  const syntaxLineCountWithinLimit = useMemo(
    () => countLinesWithinLimit(renderableCode, MAX_SYNTAX_RENDER_LINES + 1),
    [renderableCode],
  );
  const syntaxAllowedBySize = useMemo(() => {
    if (renderableCode.length > MAX_SYNTAX_RENDER_CHARS) return false;
    return syntaxLineCountWithinLimit <= MAX_SYNTAX_RENDER_LINES;
  }, [renderableCode.length, syntaxLineCountWithinLimit]);
  const interactiveLineSelection = useMemo(() => {
    if (plainTextFallback) return false;
    if (renderableCode.length > MAX_INTERACTIVE_LINE_SELECTION_CHARS) return false;
    const lineCount = countLinesWithinLimit(renderableCode, MAX_INTERACTIVE_LINE_SELECTION_LINES);
    return lineCount <= MAX_INTERACTIVE_LINE_SELECTION_LINES;
  }, [plainTextFallback, renderableCode]);
  const needsSyntaxHighlighter = Boolean(props.currentFile) && !mediaKind && !plainTextFallback;
  const shouldRenderSyntax = needsSyntaxHighlighter && syntaxAllowedBySize && Boolean(syntaxBundle && syntaxTheme);
  const lineProps = useCallback((lineNumber: number) => ({
    className: interactiveLineSelection && highlightedLinesRef.current.has(lineNumber)
      ? "code-preview-line code-preview-line-highlighted"
      : "code-preview-line",
    "data-line-number": String(lineNumber),
  }), [interactiveLineSelection]);
  const handleCodePreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!interactiveLineSelection) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const lineElement = target.closest(".code-preview-line");
    if (!(lineElement instanceof HTMLElement)) return;
    const value = lineElement.getAttribute("data-line-number");
    const lineNumber = Number(value);
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) return;

    const next = highlightedLinesRef.current;
    const isHighlighted = next.has(lineNumber);
    if (isHighlighted) {
      next.delete(lineNumber);
      lineElement.classList.remove("code-preview-line-highlighted");
    } else {
      next.add(lineNumber);
      lineElement.classList.add("code-preview-line-highlighted");
    }

    props.onHighlightedCodeChange({
      lineNumbers: Array.from(next).sort((a, b) => a - b),
    });
  }, [interactiveLineSelection, props.onHighlightedCodeChange]);

  useEffect(() => {
    if (!needsSyntaxHighlighter || !syntaxAllowedBySize || syntaxBundle || syntaxLoadFailed) return;
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
  }, [needsSyntaxHighlighter, syntaxAllowedBySize, syntaxBundle, syntaxLoadFailed]);

  const fileName = props.currentFile ? path.basename(props.currentFile) : "";
  const editorStageContent = useMemo(() => {
    if (mediaKind === "image" && mediaSrc) {
      return (
        <div className="media-preview">
          <img className="media-preview-image" src={mediaSrc} alt={props.currentFile || "Preview"} />
        </div>
      );
    }

    if (mediaKind === "video" && mediaSrc) {
      return (
        <div className="media-preview">
          <video className="media-preview-video" src={mediaSrc} controls preload="metadata" />
        </div>
      );
    }

    if (props.currentFile) {
      return (
        <div
          className={`code-preview-shell ${interactiveLineSelection ? "interactive" : "non-interactive"}`}
          onClick={shouldRenderSyntax && interactiveLineSelection ? handleCodePreviewClick : undefined}
        >
          {shouldRenderSyntax ? (
            React.createElement(
              syntaxBundle.component as any,
              {
                className: "code-preview-highlighter",
                language: codeLanguage,
                style: syntaxTheme,
                showLineNumbers: true,
                wrapLongLines: false,
                wrapLines: interactiveLineSelection,
                lineProps: interactiveLineSelection ? lineProps : undefined,
                customStyle: CODE_PREVIEW_CUSTOM_STYLE,
                lineNumberStyle: CODE_PREVIEW_LINE_NUMBER_STYLE,
                codeTagProps: CODE_PREVIEW_CODE_TAG_PROPS,
              },
              highlightedSource,
            )
          ) : (
            <VirtualCodeView
              content={highlightedSource}
              interactive={interactiveLineSelection}
              highlightedLinesRef={highlightedLinesRef}
              onHighlightedCodeChange={props.onHighlightedCodeChange}
            />
          )}
        </div>
      );
    }

    return (
      <div className="editor-empty-state">
        <img className="editor-empty-logo" src={props.logoSrc} alt="Mosaic logo" />
        <p>No file is open.</p>
      </div>
    );
  }, [
    codeLanguage,
    handleCodePreviewClick,
    highlightedSource,
    lineProps,
    mediaKind,
    mediaSrc,
    props.currentFile,
    props.logoSrc,
    interactiveLineSelection,
    highlightedLinesRef,
    shouldRenderSyntax,
    syntaxBundle,
    syntaxTheme,
  ]);

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
            {editorStageContent}
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
