import { TextAttributes } from "@cascadetui/core";
import { useKeyboard } from "@cascadetui/react";
import { VERSION } from "../utils/version";

interface WelcomeProps {
  onComplete: () => void;
  isFirstRun: boolean;
  shortcutsOpen?: boolean;
  commandsOpen?: boolean;
}

export function Welcome({ onComplete, isFirstRun, shortcutsOpen = false, commandsOpen: _commandsOpen = false }: WelcomeProps) {
  useKeyboard((key) => {
    if (shortcutsOpen) return;
    if (key.name === 'return') {
      onComplete();
    }
  });

  return (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <box flexDirection="row">
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          <ascii-font text="Mosaic" font="tiny" color="#1a1a1a" />
        </box>
        <box flexDirection="column" alignItems="flex-start" marginLeft={2}>
          <text attributes={TextAttributes.DIM}>Mosaic welcomes you !</text>
          <text attributes={TextAttributes.DIM}>Mosaic CLI v{VERSION}</text>
          <text attributes={TextAttributes.DIM}>Now are you ready to {isFirstRun ? 'configure' : 'use'} it ?</text>
        </box>
      </box>
      <box marginTop={1}>
        <box flexDirection="row">
          <text attributes={TextAttributes.DIM}>Press </text>
          <text fg="white">enter</text>
          <text attributes={TextAttributes.DIM}> to continue...</text>
        </box>
      </box>
    </box>
  );
}