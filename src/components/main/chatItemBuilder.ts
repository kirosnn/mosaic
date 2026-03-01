import { parseAndWrapMarkdown, type MarkdownSegment } from "../../utils/markdown";
import { getToolParagraphIndent, getToolWrapTarget, getToolWrapWidth, parseToolHeader } from "../../utils/toolFormatting";
import { getNativeMcpToolName } from "../../mcp/types";
import type { Message } from "./types";
import type { ImageAttachment } from "../../utils/images";
import type { QuestionRequest } from "../../utils/questionBridge";
import type { ApprovalRequest } from "../../utils/approvalBridge";
import { wrapText } from "./wrapText";

export interface RenderItem {
  key: string;
  type: 'line' | 'question' | 'approval' | 'blend' | 'tool_compact';
  content?: string;
  role: "user" | "assistant" | "tool" | "slash";
  toolName?: string;
  isFirst: boolean;
  indent?: number;
  paragraphIndex?: number;
  wrappedLineIndex?: number;
  segments?: MarkdownSegment[];
  success?: boolean;
  isError?: boolean;
  isSpacer?: boolean;
  questionRequest?: QuestionRequest;
  approvalRequest?: ApprovalRequest;
  visualLines: number;
  blendDuration?: number;
  blendWord?: string;
  isRunning?: boolean;
  runningStartTime?: number;
  isThinking?: boolean;
  isCodeBlock?: boolean;
  codeLanguage?: string;
  codeContent?: string;
  codeHeight?: number;
  isTableRow?: boolean;
  tableCells?: string[];
  tableColumnWidths?: number[];
  tableRowIndex?: number;
  isPadding?: boolean;
  isHorizontalRule?: boolean;
  planStatus?: 'pending' | 'in_progress' | 'completed';
  isCompactTool?: boolean;
  compactLabel?: string;
  compactResult?: string;
  compactLineIndex?: number;
  messageId?: string;
  messageIndex?: number;
  userMessageText?: string;
  userMessageImages?: ImageAttachment[];
}

export function isCompactTool(toolName?: string): boolean {
  if (!toolName) return false;
  if (toolName === 'read' || toolName === 'list' || toolName === 'grep' || toolName === 'glob' || toolName === 'fetch' || toolName === 'title' || toolName === 'question' || toolName === 'abort' || toolName === 'review') return true;
  if (toolName.startsWith('mcp__')) {
    const nativeName = getNativeMcpToolName(toolName);
    return nativeName === 'nativesearch_search';
  }
  return false;
}

export function getFirstBodyLine(content: string): string {
  const lines = (content || '').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const s = (lines[i] || '').trim();
    if (s) return s;
  }
  return '';
}

export function getCompactResult(message: Message): string {
  if (message.isRunning) return 'running...';
  const toolName = message.toolName;
  if (toolName === 'title') {
    const argsTitle = message.toolArgs && typeof (message.toolArgs as any).title === 'string'
      ? String((message.toolArgs as any).title)
      : '';
    const resultObj = message.toolResult && typeof message.toolResult === 'object'
      ? (message.toolResult as Record<string, unknown>)
      : null;
    const resultTitle = typeof resultObj?.title === 'string' ? resultObj.title : '';
    const t = (argsTitle || resultTitle).replace(/[\r\n]+/g, ' ').trim();
    return t || 'Completed';
  }
  if (toolName === 'read' && typeof message.toolResult === 'string') {
    const lineCount = message.toolResult ? message.toolResult.split(/\r?\n/).length : 0;
    return `Read ${lineCount} lines`;
  }
  if ((toolName === 'glob' || toolName === 'list') && typeof message.toolResult === 'string') {
    try {
      const parsed = JSON.parse(message.toolResult);
      if (Array.isArray(parsed)) {
        return `${parsed.length} results`;
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const files = Array.isArray(obj.files) ? obj.files : null;
        if (files) return `${files.length} results`;
      }
    } catch {
    }
  }
  if (toolName === 'question' && message.toolResult && typeof message.toolResult === 'object') {
    const obj = message.toolResult as Record<string, unknown>;
    const customText = typeof obj.customText === 'string' ? obj.customText.trim() : '';
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    const value = typeof obj.value === 'string' ? obj.value.trim() : '';
    if (customText) return customText;
    if (label) return label;
    if (value) return value;
    return 'Selected';
  }

  const body = getFirstBodyLine(message.displayContent ?? message.content);
  return body || 'Completed';
}

export function getPlanProgress(messages: Message[]): { inProgressStep?: string; nextStep?: string } {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'tool' || message.toolName !== 'plan') continue;
    const result = message.toolResult;
    if (!result || typeof result !== 'object') continue;
    const obj = result as Record<string, unknown>;
    const planItems = Array.isArray(obj.plan) ? obj.plan : [];
    const normalized = planItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const step = typeof entry.step === 'string' ? entry.step.trim() : '';
        const status = typeof entry.status === 'string' ? entry.status : 'pending';
        if (!step) return null;
        return { step, status };
      })
      .filter((item): item is { step: string; status: string } => !!item);

    if (normalized.length === 0) return {};

    const inProgressIndex = normalized.findIndex(item => item.status === 'in_progress');
    const inProgressStep = inProgressIndex >= 0 ? normalized[inProgressIndex]?.step : undefined;
    let nextStep: string | undefined;

    if (inProgressIndex >= 0) {
      const after = normalized.slice(inProgressIndex + 1).find(item => item.status === 'pending');
      nextStep = after?.step;
    }

    if (!nextStep) {
      nextStep = normalized.find(item => item.status === 'pending')?.step;
    }

    return { inProgressStep, nextStep };
  }

  return {};
}

export interface BuildChatItemsParams {
  messages: Message[];
  maxWidth: number;
  viewportHeight: number;
  questionRequest: QuestionRequest | null;
  approvalRequest: ApprovalRequest | null;
}

function wrapToolDiffLine(line: string, maxWidth: number): string[] {
  const match = line.match(/^([+-])\s*(\d+)\s*\|?\s*(.*)$/);
  if (!match) return wrapText(line, maxWidth);

  const sign = match[1] ?? '+';
  const lineNumber = match[2] ?? '';
  const content = match[3] ?? '';
  const lineNumberWidth = 5;
  const leftVisualPadding = 1;
  const signWidth = 1;
  const numberColumnWidth = Math.max(lineNumberWidth, lineNumber.length);
  const separatorWidth = 1;
  const contentWidth = Math.max(
    1,
    maxWidth - (leftVisualPadding + signWidth + numberColumnWidth + separatorWidth)
  );
  const chunks = wrapText(content, contentWidth);

  return chunks.map((chunk, index) => index === 0
    ? `${sign} ${lineNumber} ${chunk || ''}`
    : `${sign} | ${chunk || ''}`);
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 1 && !(lines[end - 1] ?? '').trim()) {
    end -= 1;
  }
  return lines.slice(0, end);
}

export function buildChatItems(params: BuildChatItemsParams): RenderItem[] {
  const { messages, maxWidth, viewportHeight, questionRequest, approvalRequest } = params;
  const allItems: RenderItem[] = [];
  let pendingBlend: { key: string; blendDuration: number; blendWord: string } | null = null;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    if (message.hiddenInUi) {
      continue;
    }
    const messageKey = message.id || `m-${messageIndex}`;
    const messageRole = message.displayRole ?? message.role;
    const userMessageText = message.displayContent ?? message.content;
    const userMessageImages = message.images ?? [];
    const userMessageMeta = messageRole === "user"
      ? { messageId: message.id, messageIndex, userMessageText, userMessageImages }
      : null;
    const compactTool = messageRole === 'tool' && isCompactTool(message.toolName);
    const shouldPadMessage = (messageRole === 'user' || messageRole === 'slash')
      && Boolean((message.displayContent ?? message.content) || (message.images && message.images.length > 0))
      && !compactTool;

    if (messageRole === 'user' && pendingBlend) {
      allItems.push({
        key: pendingBlend.key,
        type: 'blend',
        role: 'assistant',
        isFirst: false,
        visualLines: 1,
        blendDuration: pendingBlend.blendDuration,
        blendWord: pendingBlend.blendWord
      });
      pendingBlend = null;
    }

    if (shouldPadMessage) {
      allItems.push({
        key: `${messageKey}-message-top-pad`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        isSpacer: false,
        success: messageRole === 'slash' ? message.success : undefined,
        isRunning: message.isRunning,
        runningStartTime: message.runningStartTime,
        visualLines: 1,
        isPadding: true,
        ...(userMessageMeta ?? {})
      });
    }

    if (messageRole === 'assistant') {
      if (message.thinkingContent) {
        const thinkingLines = message.thinkingContent.split('\n');
        const thinkingItems: RenderItem[] = [];
        for (let i = 0; i < thinkingLines.length; i++) {
          const wrapped = wrapText(thinkingLines[i] || '', maxWidth - 2);
          for (let j = 0; j < wrapped.length; j++) {
            thinkingItems.push({
              key: `${messageKey}-thinking-${i}-${j}`,
              type: 'line',
              content: wrapped[j] || '',
              role: messageRole,
              isFirst: false,
              visualLines: 1,
              isThinking: true
            });
          }
        }

        if (thinkingItems.length > 0) {
          thinkingItems[0]!.content = '"' + (thinkingItems[0]!.content || '');
          const last = thinkingItems[thinkingItems.length - 1]!;
          last.content = (last.content || '') + '"';
        }
        allItems.push(...thinkingItems);

        allItems.push({
          key: `${messageKey}-thinking-spacer`,
          type: 'line',
          content: '',
          role: messageRole,
          isFirst: false,
          isSpacer: true,
          visualLines: 1,
          isThinking: true
        });
      }

      const blocks = parseAndWrapMarkdown(message.content, maxWidth);
      let isFirstContent = true;

      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex]!;
        if (block.type === 'hr') {
          allItems.push({
            key: `${messageKey}-hr-${blockIndex}`,
            type: 'line',
            role: messageRole,
            isFirst: false,
            isHorizontalRule: true,
            visualLines: 1,
            content: '',
          });
          continue;
        }

        if (block.type === 'code' && block.codeLines) {
          allItems.push({
            key: `${messageKey}-code-${blockIndex}-header`,
            type: 'line',
            role: messageRole,
            toolName: message.toolName,
            isFirst: isFirstContent,
            isCodeBlock: true,
            codeLanguage: block.language,
            codeContent: block.codeLines.join('\n'),
            codeHeight: Math.max(1, block.codeLines.length),
            visualLines: Math.max(1, block.codeLines.length)
          });
          if (block.codeLines.some(line => line.trim().length > 0)) {
            isFirstContent = false;
          }
          continue;
        }

        if (block.type === 'table' && block.tableRows && block.columnWidths && block.tableCellLines) {
          for (let rowIndex = 0; rowIndex < block.tableRows.length; rowIndex++) {
            const rowLines = block.tableCellLines[rowIndex] || [];
            const rowHeight = Math.max(1, ...rowLines.map(lines => lines.length));
            for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
              allItems.push({
                key: `${messageKey}-table-${blockIndex}-${rowIndex}-${lineIndex}`,
                type: 'line',
                content: '',
                role: messageRole,
                toolName: message.toolName,
                isFirst: isFirstContent && rowIndex === 0 && lineIndex === 0,
                isTableRow: true,
                tableCells: rowLines.map(lines => lines[lineIndex] ?? ''),
                tableColumnWidths: block.columnWidths,
                tableRowIndex: rowIndex,
                visualLines: 1
              });
            }
          }
          if (block.tableRows.some(row => row.some(cell => cell.trim().length > 0))) {
            isFirstContent = false;
          }
          continue;
        }

        if (block.type !== 'line' || !block.wrappedLines) continue;

        for (let j = 0; j < block.wrappedLines.length; j++) {
          const wrapped = block.wrappedLines[j];
          if (wrapped) {
            allItems.push({
              key: `${messageKey}-line-${blockIndex}-${j}`,
              type: 'line',
              content: wrapped.text || '',
              role: messageRole,
              toolName: message.toolName,
              isFirst: isFirstContent && j === 0,
              segments: wrapped.segments,
              isError: message.isError,
              visualLines: 1
            });
            if (wrapped.text && wrapped.text.trim()) {
              isFirstContent = false;
            }
          }
        }
      }
    } else {
      if (messageRole === 'tool' && compactTool) {
        let label: string;
        let result: string;
        if (message.toolName === 'abort' || message.toolName === 'review') {
          const firstLine = (message.displayContent ?? message.content ?? '').split('\n')[0]?.trim() || 'Interrupted';
          label = firstLine;
          result = '';
        } else {
          const { name, info } = parseToolHeader(message.toolName || '', message.toolArgs || {});
          label = message.toolName === 'title' ? name : (info ? `${name} (${info})` : name);
          result = getCompactResult(message);
        }
        const compactText = `${label}${result ? ` : ${result}` : ''}`;
        const compactLines = wrapText(compactText, Math.max(10, maxWidth - 6));
        for (let i = 0; i < compactLines.length; i++) {
          allItems.push({
            key: `${messageKey}-compact-${i}`,
            type: 'tool_compact',
            content: compactLines[i] || '',
            role: messageRole,
            toolName: message.toolName,
            isFirst: i === 0,
            visualLines: 1,
            success: message.success,
            isRunning: message.isRunning,
            runningStartTime: message.runningStartTime,
            isCompactTool: true,
            compactLabel: label,
            compactResult: result,
            compactLineIndex: i
          });
        }
      } else {
        if (messageRole === "user" && message.images && message.images.length > 0) {
          for (let i = 0; i < message.images.length; i++) {
            const image = message.images[i]!;
            allItems.push({
              key: `${messageKey}-image-${i}`,
              type: "line",
              content: `[image] ${image.name}`,
              role: messageRole,
              toolName: message.toolName,
              isFirst: i === 0,
              indent: 0,
              paragraphIndex: 0,
              wrappedLineIndex: 0,
              success: undefined,
              isSpacer: false,
              visualLines: 1,
              ...(userMessageMeta ?? {})
            });
          }
        }

        const toolCodeLanguage = (messageRole === 'tool' && message.toolArgs)
          ? (() => {
            const path = typeof (message.toolArgs as Record<string, unknown>)?.path === 'string'
              ? (message.toolArgs as Record<string, unknown>).path as string : '';
            const m = path.match(/\.([a-zA-Z0-9]+)$/);
            return m ? m[1]!.toLowerCase() : undefined;
          })()
          : undefined;

        const messageText = message.displayContent ?? message.content;
        const rawParagraphs = messageText.split('\n');
        const paragraphs = (messageRole === 'tool' || messageRole === 'slash')
          ? trimTrailingEmptyLines(rawParagraphs)
          : rawParagraphs;
        let isFirstContent = true;
        const planStatuses: Array<'pending' | 'in_progress' | 'completed'> = (messageRole === 'tool' && message.toolName === 'plan' && message.toolResult && typeof message.toolResult === 'object')
          ? (Array.isArray((message.toolResult as Record<string, unknown>).plan)
            ? (message.toolResult as Record<string, unknown>).plan as Array<Record<string, unknown>>
            : [])
            .map((item) => {
              if (!item || typeof item !== 'object') return 'pending';
              const status = (item as Record<string, unknown>).status;
              return status === 'completed' || status === 'in_progress' ? status : 'pending';
            })
          : [];
        const hasPending = planStatuses.includes('pending');
        const resolvedPlanStatuses = hasPending
          ? planStatuses
          : planStatuses.map((status) => (status === 'in_progress' ? 'completed' : status));
        let planStatusIndex = 0;

        for (let i = 0; i < paragraphs.length; i++) {
          const paragraph = paragraphs[i] ?? '';
          if (paragraph === '') {
            allItems.push({
              key: `${messageKey}-paragraph-${i}-empty`,
              type: 'line',
              content: '',
              role: messageRole,
              toolName: message.toolName,
              isFirst: false,
              indent: messageRole === 'tool' ? getToolParagraphIndent(i) : 0,
              paragraphIndex: i,
              wrappedLineIndex: 0,
              success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
              isSpacer: messageRole !== 'tool' && messageRole !== 'slash',
              visualLines: 1,
              isRunning: message.isRunning,
              runningStartTime: message.runningStartTime,
              ...(userMessageMeta ?? {})
            });
          } else {
            const indent = messageRole === 'tool' ? getToolParagraphIndent(i) : 0;
            const wrapTarget = messageRole === 'tool' ? getToolWrapTarget(paragraph, i) : paragraph;
            const wrapWidth = messageRole === 'tool' ? getToolWrapWidth(maxWidth, i) : maxWidth;
            const isToolDiffLine = messageRole === 'tool'
              && i > 0
              && /^([+-])\s*(\d+)\s*\|?\s*(.*)$/.test(wrapTarget);
            const diffLeftInset = messageRole === 'tool' && (message.toolName === 'write' || message.toolName === 'edit') ? 3 : 0;
            const wrappedLines = isToolDiffLine
              ? wrapToolDiffLine(wrapTarget, Math.max(1, wrapWidth - diffLeftInset))
              : wrapText(wrapTarget, wrapWidth);
            for (let j = 0; j < wrappedLines.length; j++) {
              const isPlanItemLine = messageRole === 'tool'
                && message.toolName === 'plan'
                && wrappedLines[j]
                && /^\[(.)\]\s+/.test(wrappedLines[j] || '');
              const planStatus = isPlanItemLine ? (resolvedPlanStatuses[planStatusIndex] ?? 'pending') : undefined;
              if (isPlanItemLine) planStatusIndex += 1;
              allItems.push({
                key: `${messageKey}-paragraph-${i}-line-${j}`,
                type: 'line',
                content: wrappedLines[j] || '',
                role: messageRole,
                toolName: message.toolName,
                isFirst: isFirstContent && i === 0 && j === 0,
                indent,
                paragraphIndex: i,
                wrappedLineIndex: j,
                success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
                isSpacer: false,
                visualLines: 1,
                planStatus,
                isRunning: message.isRunning,
                runningStartTime: message.runningStartTime,
                codeLanguage: toolCodeLanguage,
                ...(userMessageMeta ?? {})
              });
            }
            isFirstContent = false;
          }
        }
      }
    }

    if (!compactTool && shouldPadMessage) {
      allItems.push({
        key: `${messageKey}-message-bottom-pad`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        isSpacer: false,
        success: messageRole === 'slash' ? message.success : undefined,
        isRunning: message.isRunning,
        runningStartTime: message.runningStartTime,
        visualLines: 1,
        isPadding: true,
        ...(userMessageMeta ?? {})
      });
    }

    if (message.isRunning && message.runningStartTime && messageRole === 'tool' && message.toolName !== 'explore' && !compactTool) {
      allItems.push({
        key: `${messageKey}-running`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        indent: 2,
        paragraphIndex: 1,
        success: message.success,
        isSpacer: false,
        visualLines: 1,
        isRunning: true,
        runningStartTime: message.runningStartTime
      });
    }

    if (message.responseDuration && messageRole === 'assistant' && message.responseDuration > 60000) {
      pendingBlend = {
        key: `${messageKey}-blend`,
        blendDuration: message.responseDuration,
        blendWord: message.blendWord || 'Blended'
      };
    }

    const nextMessage = messageIndex + 1 < messages.length ? messages[messageIndex + 1] : null;
    const nextRole = nextMessage ? (nextMessage.displayRole ?? nextMessage.role) : null;
    const nextCompactTool = Boolean(nextMessage && nextRole === 'tool' && isCompactTool(nextMessage.toolName));
    const shouldAddSpacer = !(compactTool && nextCompactTool);

    if (shouldAddSpacer) {
      allItems.push({
        key: `${messageKey}-spacer`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        isSpacer: true,
        visualLines: 1
      });
    }
  }

  if (pendingBlend) {
    allItems.push({
      key: pendingBlend.key,
      type: 'blend',
      role: 'assistant',
      isFirst: false,
      visualLines: 1,
      blendDuration: pendingBlend.blendDuration,
      blendWord: pendingBlend.blendWord
    });
  }

  if (questionRequest) {
    const questionPanelLines = Math.max(6, 5 + questionRequest.options.length);
    const currentTotalLines = allItems.reduce((sum, item) => sum + item.visualLines, 0);
    const linesFromBottom = currentTotalLines % viewportHeight;
    const spaceNeeded = viewportHeight - linesFromBottom;

    if (linesFromBottom > 0 && questionPanelLines + 2 > spaceNeeded) {
      allItems.push({
        key: `question-${questionRequest.id}-pagebreak`,
        type: 'line',
        content: '',
        role: 'assistant',
        isFirst: false,
        isSpacer: true,
        visualLines: spaceNeeded,
      });
    }

    allItems.push({
      key: `question-${questionRequest.id}`,
      type: 'question',
      role: 'assistant',
      isFirst: true,
      questionRequest,
      visualLines: questionPanelLines,
    });
    allItems.push({
      key: `question-${questionRequest.id}-spacer`,
      type: 'line',
      content: '',
      role: 'assistant',
      isFirst: false,
      isSpacer: true,
      visualLines: 1,
    });
  }

  if (approvalRequest) {
    const previewLines = approvalRequest.preview.content.split('\n').length;
    const maxVisibleLines = Math.min(previewLines, 6);
    const optionLines = approvalRequest.toolName === 'bash' ? 3 : 2;
    const reasonLines = Array.isArray(approvalRequest.preview.details) && approvalRequest.preview.details.length > 0 ? 1 : 0;
    const approvalPanelLines = 6 + reasonLines + maxVisibleLines + optionLines;

    allItems.push({
      key: `approval-${approvalRequest.id}`,
      type: 'approval',
      role: 'assistant',
      isFirst: true,
      approvalRequest,
      visualLines: approvalPanelLines,
    });
    allItems.push({
      key: `approval-${approvalRequest.id}-spacer`,
      type: 'line',
      content: '',
      role: 'assistant',
      isFirst: false,
      isSpacer: true,
      visualLines: 1,
    });
  }

  const deduplicated: RenderItem[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i]!;
    const isEmptyLine = !item.content?.trim()
      && !item.isPadding
      && !item.isCodeBlock
      && !item.isTableRow
      && !item.isHorizontalRule
      && item.type !== 'question'
      && item.type !== 'approval'
      && item.type !== 'tool_compact'
      && item.type !== 'blend';

    if (isEmptyLine && deduplicated.length > 0) {
      const prev = deduplicated[deduplicated.length - 1]!;
      const prevIsEmpty = !prev.content?.trim()
        && !prev.isPadding
        && !prev.isCodeBlock
        && !prev.isTableRow
        && !prev.isHorizontalRule
        && prev.type !== 'question'
        && prev.type !== 'approval'
        && prev.type !== 'tool_compact'
        && prev.type !== 'blend';

      if (prevIsEmpty) {
        continue;
      }
    }

    deduplicated.push(item);
  }

  return deduplicated;
}
