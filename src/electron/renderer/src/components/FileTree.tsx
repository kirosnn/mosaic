import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Film
} from "lucide-react";
import {
  type SimpleIcon,
  siBun,
  siC,
  siCplusplus,
  siCss,
  siDart,
  siDocker,
  siDotenv,
  siElixir,
  siErlang,
  siGit,
  siGnubash,
  siGo,
  siGraphql,
  siHaskell,
  siHtml5,
  siJavascript,
  siJson,
  siKotlin,
  siLua,
  siMarkdown,
  siNpm,
  siOpenjdk,
  siPerl,
  siPhp,
  siPnpm,
  siPython,
  siR,
  siReact,
  siRuby,
  siRust,
  siSass,
  siSharp,
  siSvelte,
  siSwift,
  siToml,
  siTypescript,
  siVuedotjs,
  siYaml,
  siYarn
} from "simple-icons";
import type { FsEntry } from "../types";

interface FileTreeProps {
  parentPath: string;
  directoryCache: Record<string, FsEntry[]>;
  openDirectories: Set<string>;
  currentFile: string;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}

type BrandToken =
  | "bun"
  | "c"
  | "cpp"
  | "css"
  | "dart"
  | "docker"
  | "dotenv"
  | "elixir"
  | "erlang"
  | "git"
  | "shell"
  | "go"
  | "graphql"
  | "haskell"
  | "html"
  | "js"
  | "json"
  | "kotlin"
  | "lua"
  | "markdown"
  | "java"
  | "npm"
  | "perl"
  | "php"
  | "pnpm"
  | "python"
  | "r"
  | "react"
  | "ruby"
  | "rust"
  | "sass"
  | "csharp"
  | "svelte"
  | "swift"
  | "toml"
  | "ts"
  | "vue"
  | "yaml"
  | "yarn";

type FileIconDescriptor =
  | { kind: "brand"; token: BrandToken }
  | { kind: "image" }
  | { kind: "video" }
  | { kind: "default" };

interface FlatTreeRow {
  entry: FsEntry;
  depth: number;
  isDirectory: boolean;
  isOpen: boolean;
  isSelected: boolean;
}

interface FileTreeRowProps {
  row: FlatTreeRow;
  top: number;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}

const BRAND_ICON_BY_TOKEN: Record<BrandToken, SimpleIcon> = {
  bun: siBun,
  c: siC,
  cpp: siCplusplus,
  css: siCss,
  dart: siDart,
  docker: siDocker,
  dotenv: siDotenv,
  elixir: siElixir,
  erlang: siErlang,
  git: siGit,
  shell: siGnubash,
  go: siGo,
  graphql: siGraphql,
  haskell: siHaskell,
  html: siHtml5,
  js: siJavascript,
  json: siJson,
  kotlin: siKotlin,
  lua: siLua,
  markdown: siMarkdown,
  java: siOpenjdk,
  npm: siNpm,
  perl: siPerl,
  php: siPhp,
  pnpm: siPnpm,
  python: siPython,
  r: siR,
  react: siReact,
  ruby: siRuby,
  rust: siRust,
  sass: siSass,
  csharp: siSharp,
  svelte: siSvelte,
  swift: siSwift,
  toml: siToml,
  ts: siTypescript,
  vue: siVuedotjs,
  yaml: siYaml,
  yarn: siYarn,
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".bmp", ".ico", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"]);
const FILE_ICON_SIZE = 12;
const FILE_TREE_ROW_HEIGHT = 20;
const FILE_TREE_OVERSCAN_ROWS = 20;
const FILE_TREE_INDENT_PX = 16;
const fileIconDescriptorCache = new Map<string, FileIconDescriptor>();

function renderBrandIcon(token: BrandToken): React.ReactNode {
  const icon = BRAND_ICON_BY_TOKEN[token];
  return (
    <svg
      viewBox="0 0 24 24"
      width={FILE_ICON_SIZE}
      height={FILE_ICON_SIZE}
      aria-hidden="true"
      className="file-icon file-brand-icon"
      style={{ ["--file-icon-color" as string]: `var(--tree-icon-${token})` } as React.CSSProperties}
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

function computeFileIconDescriptor(lowerName: string): FileIconDescriptor {
  const ext = path.extname(lowerName);

  if (lowerName === ".gitignore" || lowerName === ".gitattributes" || lowerName === ".gitmodules" || lowerName.startsWith(".git")) {
    return { kind: "brand", token: "git" };
  }
  if (lowerName === "package.json" || lowerName === "package-lock.json" || lowerName === "npm-shrinkwrap.json") {
    return { kind: "brand", token: "npm" };
  }
  if (lowerName === "bun.lock" || lowerName === "bunfig.toml") {
    return { kind: "brand", token: "bun" };
  }
  if (lowerName === "pnpm-lock.yaml") {
    return { kind: "brand", token: "pnpm" };
  }
  if (lowerName === "yarn.lock") {
    return { kind: "brand", token: "yarn" };
  }
  if (lowerName === "dockerfile" || lowerName === "docker-compose.yml" || lowerName === "docker-compose.yaml") {
    return { kind: "brand", token: "docker" };
  }
  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return { kind: "brand", token: "dotenv" };
  }

  switch (ext) {
    case ".ts":
      return { kind: "brand", token: "ts" };
    case ".tsx":
      return { kind: "brand", token: "react" };
    case ".js":
    case ".mjs":
    case ".cjs":
      return { kind: "brand", token: "js" };
    case ".jsx":
      return { kind: "brand", token: "react" };
    case ".json":
      return { kind: "brand", token: "json" };
    case ".css":
      return { kind: "brand", token: "css" };
    case ".scss":
    case ".sass":
      return { kind: "brand", token: "sass" };
    case ".html":
    case ".htm":
      return { kind: "brand", token: "html" };
    case ".md":
    case ".mdx":
      return { kind: "brand", token: "markdown" };
    case ".py":
      return { kind: "brand", token: "python" };
    case ".go":
      return { kind: "brand", token: "go" };
    case ".rs":
      return { kind: "brand", token: "rust" };
    case ".php":
      return { kind: "brand", token: "php" };
    case ".rb":
      return { kind: "brand", token: "ruby" };
    case ".swift":
      return { kind: "brand", token: "swift" };
    case ".kt":
    case ".kts":
      return { kind: "brand", token: "kotlin" };
    case ".cs":
      return { kind: "brand", token: "csharp" };
    case ".java":
      return { kind: "brand", token: "java" };
    case ".c":
    case ".h":
      return { kind: "brand", token: "c" };
    case ".cpp":
    case ".cxx":
    case ".cc":
    case ".hpp":
    case ".hxx":
    case ".hh":
      return { kind: "brand", token: "cpp" };
    case ".yml":
    case ".yaml":
      return { kind: "brand", token: "yaml" };
    case ".toml":
      return { kind: "brand", token: "toml" };
    case ".graphql":
    case ".gql":
      return { kind: "brand", token: "graphql" };
    case ".vue":
      return { kind: "brand", token: "vue" };
    case ".svelte":
      return { kind: "brand", token: "svelte" };
    case ".sh":
    case ".zsh":
    case ".bash":
    case ".fish":
    case ".ps1":
    case ".psm1":
    case ".psd1":
      return { kind: "brand", token: "shell" };
    case ".lua":
      return { kind: "brand", token: "lua" };
    case ".pl":
    case ".pm":
      return { kind: "brand", token: "perl" };
    case ".r":
      return { kind: "brand", token: "r" };
    case ".dart":
      return { kind: "brand", token: "dart" };
    case ".ex":
    case ".exs":
      return { kind: "brand", token: "elixir" };
    case ".erl":
    case ".hrl":
      return { kind: "brand", token: "erlang" };
    case ".hs":
      return { kind: "brand", token: "haskell" };
    default:
      break;
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return { kind: "image" };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return { kind: "video" };
  }
  return { kind: "default" };
}

function getFileIconDescriptor(fileName: string): FileIconDescriptor {
  const key = fileName.toLowerCase();
  const cached = fileIconDescriptorCache.get(key);
  if (cached) return cached;
  const next = computeFileIconDescriptor(key);
  fileIconDescriptorCache.set(key, next);
  return next;
}

function renderFileIcon(fileName: string): React.ReactNode {
  const descriptor = getFileIconDescriptor(fileName);
  if (descriptor.kind === "brand") {
    return renderBrandIcon(descriptor.token);
  }
  if (descriptor.kind === "image") {
    return <ImageIcon size={FILE_ICON_SIZE} className="file-icon image" />;
  }
  if (descriptor.kind === "video") {
    return <Film size={FILE_ICON_SIZE} className="file-icon video" />;
  }
  return <File size={FILE_ICON_SIZE} className="file-icon default" />;
}

function collectVisibleRows(
  parentPath: string,
  depth: number,
  directoryCache: Record<string, FsEntry[]>,
  openDirectories: Set<string>,
  currentFile: string,
  out: FlatTreeRow[],
): void {
  const entries = directoryCache[parentPath] || [];
  for (const entry of entries) {
    const entryPath = entry.relativePath;
    const isDirectory = entry.type === "directory";
    const isOpen = isDirectory ? openDirectories.has(entryPath) : false;
    out.push({
      entry,
      depth,
      isDirectory,
      isOpen,
      isSelected: currentFile === entryPath,
    });
    if (isDirectory && isOpen) {
      collectVisibleRows(entryPath, depth + 1, directoryCache, openDirectories, currentFile, out);
    }
  }
}

const FileTreeRow = memo(
  function FileTreeRow(props: FileTreeRowProps) {
    const entryPath = props.row.entry.relativePath;
    return (
      <div
        className={`file-tree-row file-tree-row-virtual ${props.row.isSelected ? "selected" : ""}`}
        style={{
          transform: `translateY(${props.top}px)`,
          paddingLeft: `${props.row.depth * FILE_TREE_INDENT_PX}px`,
        }}
        onClick={() => {
          if (props.row.isDirectory) {
            props.onToggleDirectory(entryPath);
          } else {
            props.onOpenFile(entryPath);
          }
        }}
      >
        <span className="file-icon-container">
          {props.row.isDirectory ? (
            props.row.isOpen ? (
              <ChevronDown size={FILE_ICON_SIZE} className="tree-arrow" />
            ) : (
              <ChevronRight size={FILE_ICON_SIZE} className="tree-arrow" />
            )
          ) : (
            <span className="tree-spacer" />
          )}
        </span>

        <span className="file-type-icon">
          {props.row.isDirectory ? (
            props.row.isOpen ? <FolderOpen size={FILE_ICON_SIZE} className="file-icon folder-icon" /> : <Folder size={FILE_ICON_SIZE} className="file-icon folder-icon" />
          ) : (
            renderFileIcon(props.row.entry.name)
          )}
        </span>

        <span className="file-name">{props.row.entry.name}</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.top !== nextProps.top) return false;
    if (prevProps.onToggleDirectory !== nextProps.onToggleDirectory) return false;
    if (prevProps.onOpenFile !== nextProps.onOpenFile) return false;
    if (prevProps.row.depth !== nextProps.row.depth) return false;
    if (prevProps.row.isDirectory !== nextProps.row.isDirectory) return false;
    if (prevProps.row.isOpen !== nextProps.row.isOpen) return false;
    if (prevProps.row.isSelected !== nextProps.row.isSelected) return false;
    if (prevProps.row.entry.name !== nextProps.row.entry.name) return false;
    if (prevProps.row.entry.relativePath !== nextProps.row.entry.relativePath) return false;
    if (prevProps.row.entry.type !== nextProps.row.entry.type) return false;
    return true;
  },
);

export function FileTree({
  parentPath,
  directoryCache,
  openDirectories,
  currentFile,
  onToggleDirectory,
  onOpenFile,
}: FileTreeProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);

  const rows = useMemo(() => {
    const next: FlatTreeRow[] = [];
    collectVisibleRows(parentPath, 0, directoryCache, openDirectories, currentFile, next);
    return next;
  }, [parentPath, directoryCache, openDirectories, currentFile]);

  const totalHeight = rows.length * FILE_TREE_ROW_HEIGHT;

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
    if (rows.length === 0) return { start: 0, end: 0 };
    if (viewportHeight <= 0) {
      return {
        start: Math.max(0, rows.length - 100),
        end: rows.length,
      };
    }
    const start = Math.max(0, Math.floor(scrollTop / FILE_TREE_ROW_HEIGHT) - FILE_TREE_OVERSCAN_ROWS);
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / FILE_TREE_ROW_HEIGHT) + FILE_TREE_OVERSCAN_ROWS,
    );
    return { start, end };
  }, [rows.length, scrollTop, viewportHeight]);

  const visibleRows = useMemo(
    () => rows.slice(visibleRange.start, visibleRange.end),
    [rows, visibleRange.end, visibleRange.start],
  );

  return (
    <div className="file-tree-viewport" ref={viewportRef} onScroll={onScroll}>
      <div className="file-tree-list file-tree-virtual" style={{ height: `${totalHeight}px` }}>
        {visibleRows.map((row, index) => {
          const absoluteIndex = visibleRange.start + index;
          const top = absoluteIndex * FILE_TREE_ROW_HEIGHT;
          return (
            <FileTreeRow
              key={row.entry.relativePath || row.entry.name}
              row={row}
              top={top}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          );
        })}
      </div>
    </div>
  );
}
