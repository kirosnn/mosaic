import { useState, useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { CustomInput } from "./CustomInput";
import { VERSION } from "../utils/version";
import { useKeyboard } from "@opentui/react";
import { sendMessage } from "../agent";
import { parseMarkdownLine, renderMarkdownSegment, wrapMarkdownText } from "../utils/markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MainProps {
  pasteRequestId?: number;
  shortcutsOpen?: boolean;
}

export function Main({ pasteRequestId = 0, shortcutsOpen = false }: MainProps) {
  const [currentPage, setCurrentPage] = useState<"home" | "chat">("home");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows || 24);
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    const handleResize = () => {
      setTerminalWidth(process.stdout.columns || 80);
      setTerminalHeight(process.stdout.rows || 24);
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  const wrapText = (text: string, maxWidth: number): string[] => {
    if (!text) return [''];
    if (text.length <= maxWidth) return [text];

    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (word.length > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        for (let i = 0; i < word.length; i += maxWidth) {
          lines.push(word.slice(i, i + maxWidth));
        }
      } else if (currentLine && (currentLine + ' ' + word).length > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  };

  useEffect(() => {
    if (currentPage !== "chat") return;

    process.stdin.setRawMode(true);
    process.stdout.write('\x1b[?1000h');
    process.stdout.write('\x1b[?1003h');
    process.stdout.write('\x1b[?1006h');

    const handleData = (data: Buffer) => {
      const str = data.toString();

      if (str.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/)) {
        const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/);
        if (match) {
          const button = parseInt(match[1] || '0');

          if (button === 64) {
            shouldAutoScroll.current = false;
            setScrollOffset((prev) => prev + 3);
          } else if (button === 65) {
            setScrollOffset((prev) => {
              const newOffset = Math.max(0, prev - 3);
              if (newOffset === 0) {
                shouldAutoScroll.current = true;
              }
              return newOffset;
            });
          }
        }
      }
    };

    process.stdin.on('data', handleData);

    return () => {
      process.stdin.off('data', handleData);
      process.stdout.write('\x1b[?1000l');
      process.stdout.write('\x1b[?1003l');
      process.stdout.write('\x1b[?1006l');
    };
  }, [currentPage]);

  useEffect(() => {
    if (shouldAutoScroll.current && currentPage === "chat") {
      setScrollOffset(0);
    }
  }, [messages.length, currentPage]);

  useKeyboard((key) => {
    if (currentPage !== "chat") return;
    if (shortcutsOpen) return;

    if (key.name === 'up') {
      shouldAutoScroll.current = false;
      setScrollOffset((prev) => prev + 2);
    } else if (key.name === 'down') {
      setScrollOffset((prev) => {
        const newOffset = Math.max(0, prev - 2);
        if (newOffset === 0) {
          shouldAutoScroll.current = true;
        }
        return newOffset;
      });
    } else if (key.name === 'pageup') {
      shouldAutoScroll.current = false;
      setScrollOffset((prev) => prev + 10);
    } else if (key.name === 'pagedown') {
      setScrollOffset((prev) => {
        const newOffset = Math.max(0, prev - 10);
        if (newOffset === 0) {
          shouldAutoScroll.current = true;
        }
        return newOffset;
      });
    }
  });

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return;

    const userMessage: Message = { role: "user", content: value };
    setMessages((prev: Message[]) => [...prev, userMessage]);
    setIsProcessing(true);
    shouldAutoScroll.current = true;

    try {
      const conversationHistory = [...messages, userMessage];
      let assistantContent = '';

      setMessages((prev: Message[]) => [...prev, { role: "assistant", content: '' }]);

      for await (const chunk of sendMessage(conversationHistory)) {
        assistantContent += chunk;
        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content: assistantContent
          };
          return newMessages;
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setMessages((prev: Message[]) => {
        const newMessages = [...prev];
        if (newMessages[newMessages.length - 1]?.role === 'assistant' && newMessages[newMessages.length - 1]?.content === '') {
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content: `Error: ${errorMessage}`
          };
        } else {
          newMessages.push({
            role: "assistant",
            content: `Error: ${errorMessage}`
          });
        }
        return newMessages;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (currentPage === "home") {
    const handleHomeSubmit = (value: string) => {
      if (!value.trim()) return;
      setCurrentPage("chat");
      handleSubmit(value);
    };

    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╗   ███╗</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>████╗ ████║</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╔████╔███║</text>
        </box>

        <box width="80%" maxWidth={80}>
          <box
            flexDirection="row"
            backgroundColor="#1a1a1a"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <CustomInput
              onSubmit={handleHomeSubmit}
              placeholder="Ask anything..."
              focused={!shortcutsOpen}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            />
          </box>
        </box>

        <box position="absolute" bottom={1} right={2}>
          <text fg="gray" attributes={TextAttributes.DIM}>v{VERSION}</text>
        </box>
      </box>
    );
  }

  const maxWidth = Math.max(20, terminalWidth - 6);
  const viewportHeight = Math.max(5, terminalHeight - 5);

  interface RenderLine {
    content: string;
    role: "user" | "assistant";
    isFirst: boolean;
    segments?: import("../utils/markdown").MarkdownSegment[];
  }

  const allLines: RenderLine[] = [];

  for (const message of messages) {
    const paragraphs = message.content.split('\n');

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      if (!paragraph || paragraph.trim() === '') {
        allLines.push({
          content: '',
          role: message.role,
          isFirst: i === 0 && allLines.filter(l => l.role === message.role && l.content !== '').length === 0
        });
      } else {
        if (message.role === 'assistant') {
          const wrappedLines = wrapMarkdownText(paragraph, maxWidth);
          for (let j = 0; j < wrappedLines.length; j++) {
            allLines.push({
              content: wrappedLines[j]?.text || '',
              role: message.role,
              isFirst: i === 0 && j === 0 && allLines.filter(l => l.role === message.role && l.content !== '').length === 0,
              segments: wrappedLines[j]?.segments
            });
          }
        } else {
          const wrappedLines = wrapText(paragraph, maxWidth);
          for (let j = 0; j < wrappedLines.length; j++) {
            allLines.push({
              content: wrappedLines[j] || '',
              role: message.role,
              isFirst: i === 0 && j === 0 && allLines.filter(l => l.role === message.role && l.content !== '').length === 0
            });
          }
        }
      }
    }

    allLines.push({
      content: '',
      role: message.role,
      isFirst: false
    });
  }

  if (isProcessing) {
    allLines.push({
      content: 'Thinking...',
      role: 'assistant',
      isFirst: true
    });
  }

  const totalLines = allLines.length;
  const maxOffset = Math.max(0, totalLines - viewportHeight);

  const startIndex = Math.max(0, totalLines - viewportHeight - scrollOffset);
  const endIndex = Math.min(totalLines, startIndex + viewportHeight);

  const visibleLines = allLines.slice(startIndex, endIndex);

  return (
    <box flexDirection="column" width="100%" height="100%" position="relative">
      <box flexGrow={1} flexDirection="column" width="100%" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={3}>
        {visibleLines.map((line, index) => {
          return (
            <box
              key={startIndex + index}
              flexDirection="row"
              width="100%"
              backgroundColor={line.role === "user" && line.content ? "#1a1a1a" : "transparent"}
              paddingRight={line.role === "user" ? 1 : 0}
            >
              {line.role === "user" && line.content && (
                <text fg="#ffca38">▎ </text>
              )}
              {line.role === "user" ? (
                <text fg="white">{line.content || ' '}</text>
              ) : line.segments && line.segments.length > 0 ? (
                <>
                  {line.segments.map((segment, segIndex) => renderMarkdownSegment(segment, segIndex))}
                </>
              ) : (
                <text fg="white">{line.content || ' '}</text>
              )}
            </box>
          );
        })}
      </box>

      <box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        flexDirection="column"
        backgroundColor="#1a1a1a"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        flexShrink={0}
        minHeight={3}
        minWidth="100%"
      >
        <box flexDirection="row" alignItems="center" width="100%" flexGrow={1} minWidth={0}>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <CustomInput
              onSubmit={handleSubmit}
              placeholder="Type your message..."
              focused={!isProcessing && !shortcutsOpen}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            />
          </box>
        </box>
      </box>
    </box>
  );
}