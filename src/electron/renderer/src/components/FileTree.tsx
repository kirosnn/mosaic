import React from "react";
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

function getFileIcon(fileName: string): React.ReactNode {
  const lowerName = fileName.toLowerCase();
  const ext = path.extname(lowerName);

  if (lowerName === ".gitignore" || lowerName === ".gitattributes" || lowerName === ".gitmodules" || lowerName.startsWith(".git")) {
    return renderBrandIcon("git");
  }

  if (lowerName === "package.json" || lowerName === "package-lock.json" || lowerName === "npm-shrinkwrap.json") {
    return renderBrandIcon("npm");
  }

  if (lowerName === "bun.lock" || lowerName === "bunfig.toml") {
    return renderBrandIcon("bun");
  }

  if (lowerName === "pnpm-lock.yaml") {
    return renderBrandIcon("pnpm");
  }

  if (lowerName === "yarn.lock") {
    return renderBrandIcon("yarn");
  }

  if (lowerName === "dockerfile" || lowerName === "docker-compose.yml" || lowerName === "docker-compose.yaml") {
    return renderBrandIcon("docker");
  }

  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return renderBrandIcon("dotenv");
  }

  switch (ext) {
    case ".ts":
      return renderBrandIcon("ts");
    case ".tsx":
      return renderBrandIcon("react");
    case ".js":
    case ".mjs":
    case ".cjs":
      return renderBrandIcon("js");
    case ".jsx":
      return renderBrandIcon("react");
    case ".json":
      return renderBrandIcon("json");
    case ".css":
      return renderBrandIcon("css");
    case ".scss":
    case ".sass":
      return renderBrandIcon("sass");
    case ".html":
    case ".htm":
      return renderBrandIcon("html");
    case ".md":
    case ".mdx":
      return renderBrandIcon("markdown");
    case ".py":
      return renderBrandIcon("python");
    case ".go":
      return renderBrandIcon("go");
    case ".rs":
      return renderBrandIcon("rust");
    case ".php":
      return renderBrandIcon("php");
    case ".rb":
      return renderBrandIcon("ruby");
    case ".swift":
      return renderBrandIcon("swift");
    case ".kt":
    case ".kts":
      return renderBrandIcon("kotlin");
    case ".cs":
      return renderBrandIcon("csharp");
    case ".java":
      return renderBrandIcon("java");
    case ".c":
    case ".h":
      return renderBrandIcon("c");
    case ".cpp":
    case ".cxx":
    case ".cc":
    case ".hpp":
    case ".hxx":
    case ".hh":
      return renderBrandIcon("cpp");
    case ".yml":
    case ".yaml":
      return renderBrandIcon("yaml");
    case ".toml":
      return renderBrandIcon("toml");
    case ".graphql":
    case ".gql":
      return renderBrandIcon("graphql");
    case ".vue":
      return renderBrandIcon("vue");
    case ".svelte":
      return renderBrandIcon("svelte");
    case ".sh":
    case ".zsh":
    case ".bash":
    case ".fish":
    case ".ps1":
    case ".psm1":
    case ".psd1":
      return renderBrandIcon("shell");
    case ".lua":
      return renderBrandIcon("lua");
    case ".pl":
    case ".pm":
      return renderBrandIcon("perl");
    case ".r":
      return renderBrandIcon("r");
    case ".dart":
      return renderBrandIcon("dart");
    case ".ex":
    case ".exs":
      return renderBrandIcon("elixir");
    case ".erl":
    case ".hrl":
      return renderBrandIcon("erlang");
    case ".hs":
      return renderBrandIcon("haskell");
    default:
      break;
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return <ImageIcon size={FILE_ICON_SIZE} className="file-icon image" />;
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return <Film size={FILE_ICON_SIZE} className="file-icon video" />;
  }

  return <File size={FILE_ICON_SIZE} className="file-icon default" />;
}

export function FileTree({
  parentPath,
  directoryCache,
  openDirectories,
  currentFile,
  onToggleDirectory,
  onOpenFile,
}: FileTreeProps) {
  const entries = directoryCache[parentPath] || [];

  const sortedEntries = [...entries].sort((a, b) => {
    const aIsDirectory = a.type === "directory";
    const bIsDirectory = b.type === "directory";
    if (aIsDirectory === bIsDirectory) {
      return a.name.localeCompare(b.name);
    }
    return aIsDirectory ? -1 : 1;
  });

  return (
    <div className="file-tree-list">
      {sortedEntries.map((entry) => {
        const entryPath = entry.relativePath;
        const isDirectory = entry.type === "directory";
        const isOpen = isDirectory ? openDirectories.has(entryPath) : false;
        const isSelected = currentFile === entryPath;

        return (
          <div key={entryPath || entry.name} className="file-tree-item-container">
            <div
              className={`file-tree-row ${isSelected ? "selected" : ""}`}
              onClick={() => {
                if (isDirectory) {
                  onToggleDirectory(entryPath);
                } else {
                  onOpenFile(entryPath);
                }
              }}
            >
              <span className="file-tree-indent-guide" />

              <span className="file-icon-container">
                {isDirectory ? (
                  isOpen ? (
                    <ChevronDown size={FILE_ICON_SIZE} className="tree-arrow" />
                  ) : (
                    <ChevronRight size={FILE_ICON_SIZE} className="tree-arrow" />
                  )
                ) : (
                  <span className="tree-spacer" />
                )}
              </span>

              <span className="file-type-icon">
                {isDirectory ? (
                  isOpen ? <FolderOpen size={FILE_ICON_SIZE} className="file-icon folder-icon" /> : <Folder size={FILE_ICON_SIZE} className="file-icon folder-icon" />
                ) : (
                  getFileIcon(entry.name)
                )}
              </span>

              <span className="file-name">{entry.name}</span>
            </div>

            {isDirectory && isOpen && (
              <div className="file-tree-children">
                <FileTree
                  parentPath={entryPath}
                  directoryCache={directoryCache}
                  openDirectories={openDirectories}
                  currentFile={currentFile}
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
