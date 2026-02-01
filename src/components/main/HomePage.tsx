import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { VERSION } from "../../utils/version";
import { CustomInput } from "../CustomInput";

interface HomePageProps {
  onSubmit: (value: string, meta?: import("../CustomInput").InputSubmitMeta) => void;
  pasteRequestId: number;
  shortcutsOpen: boolean;
}

const TIPS = [
  "Press ⌘ + P to view all available shortcuts.",
  "Use the Up and Down arrows to navigate through message history.",
  "Press Esc to cancel the current action or close popups.",
  "Paste text using ⌘ + V.",
  "Use /clear to reset the current chat session.",
  "Use Tab to autocomplete commands and arguments.",
  "Use ⌘ + K to clear the current input line.",
  "Use ⌘ + G to edit the current input in your system editor.",
  "Use /help to display the list of available commands.",
  "Select text with the mouse to copy it automatically.",
  "Attach an image with /image <path>.",
  "Paste an image with ⌘ + V.",
];

export function HomePage({ onSubmit, pasteRequestId, shortcutsOpen }: HomePageProps) {
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setTerminalWidth(process.stdout.columns || 80);
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (isWaiting) {
      const timeout = setTimeout(() => {
        setIsWaiting(false);
        setIsDeleting(true);
      }, 5000);
      return () => clearTimeout(timeout);
    }

    const currentTip = TIPS[currentTipIndex] || "";

    if (isDeleting) {
      if (displayedText.length === 0) {
        setIsDeleting(false);
        let nextIndex = Math.floor(Math.random() * TIPS.length);
        while (nextIndex === currentTipIndex && TIPS.length > 1) {
          nextIndex = Math.floor(Math.random() * TIPS.length);
        }
        setCurrentTipIndex(nextIndex);
      } else {
        const timeout = setTimeout(() => {
          setDisplayedText((prev) => prev.slice(0, -1));
        }, 30);
        return () => clearTimeout(timeout);
      }
    } else {
      if (displayedText === currentTip) {
        setIsWaiting(true);
      } else {
        const timeout = setTimeout(() => {
          setDisplayedText(currentTip.slice(0, displayedText.length + 1));
        }, 60);
        return () => clearTimeout(timeout);
      }
    }
  }, [displayedText, isDeleting, isWaiting, currentTipIndex]);

  const containerWidth = Math.min(80, Math.floor(terminalWidth * 0.8));
  const inputWidth = Math.max(10, containerWidth - 4);

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
            onSubmit={onSubmit}
            placeholder="Ask anything..."
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            maxWidth={inputWidth}
          />
        </box>
      </box>

      <box width="80%" maxWidth={80} marginTop={3} flexDirection="row" justifyContent="center">
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>● TIPS: </text>
        <text fg="gray">{displayedText}</text>
        <text fg="#ffca38">{cursorVisible ? "█" : " "}</text>
      </box>

      <box position="absolute" bottom={1} right={2}>
        <text fg="gray" attributes={TextAttributes.DIM}>v{VERSION}</text>
      </box>
    </box>
  );
}
