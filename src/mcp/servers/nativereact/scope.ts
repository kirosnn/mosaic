import type { ProjectInfo, SourceFile } from './types.js';

export type AnalysisMode = 'smart' | 'full';

const REACT_IMPORT_PATTERN =
  /\bfrom\s+['"](?:react|react-dom|react-native|react\/jsx-runtime|next\/[^'"]+|expo|@remix-run\/react|gatsby|@tanstack\/react-start|@react-router\/[^'"]+)['"]/;
const JSX_PATTERN = /<([A-Z][A-Za-z0-9]*|[a-z]+)(\s|>)/;
const HOOK_CALL_PATTERN =
  /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|Context|LayoutEffect|Transition|Optimistic|ActionState|ImperativeHandle|DeferredValue|Id)\s*\(/;
const RN_PRIMITIVE_PATTERN = /\b(?:View|Text|Pressable|TouchableOpacity|FlatList|SectionList|ScrollView|StyleSheet)\b/;
const REACT_PATH_HINT_PATTERN =
  /[\\/](?:app|pages|components?|screens?|routes?|layouts?|ui|widgets?|features?|web|mobile|native)[\\/]/i;
const NON_REACT_PATH_PATTERN = /[\\/](?:benchmark|scripts?|docs?|mcp|agent)[\\/]/i;

export function isLikelyReactFile(file: SourceFile, projectInfo: ProjectInfo): boolean {
  const path = file.path;
  const content = file.content;
  const ext = file.ext.toLowerCase();

  if (ext === '.tsx' || ext === '.jsx') return true;
  if (file.isClientComponent || file.isServerComponent) return true;
  if (REACT_IMPORT_PATTERN.test(content)) return true;

  if (projectInfo.isReactNative && RN_PRIMITIVE_PATTERN.test(content)) return true;

  if (HOOK_CALL_PATTERN.test(content) && (REACT_PATH_HINT_PATTERN.test(path) || JSX_PATTERN.test(content))) {
    return true;
  }

  if (REACT_PATH_HINT_PATTERN.test(path) && JSX_PATTERN.test(content)) return true;

  if (projectInfo.framework === 'nextjs') {
    if (/[\\/](?:app|pages)[\\/]/i.test(path)) return true;
    if (/[\\/](?:layout|page|loading|error|not-found|template|route)\.(?:tsx|jsx|ts|js|mts|mjs|cts|cjs)$/i.test(path)) {
      return true;
    }
  }

  return false;
}

export function shouldAnalyzeFile(
  file: SourceFile,
  projectInfo: ProjectInfo,
  mode: AnalysisMode,
): boolean {
  if (mode === 'full') return true;
  if (file.isTest) return false;
  if (NON_REACT_PATH_PATTERN.test(file.path) && !isLikelyReactFile(file, projectInfo)) return false;
  return isLikelyReactFile(file, projectInfo);
}
