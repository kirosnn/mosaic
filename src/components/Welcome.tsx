import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
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
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╗   ███╗</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>████╗ ████║</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╔████╔███║</text>
        </box>
        <box flexDirection="column" alignItems="flex-start" marginLeft={2}>
          <text attributes={TextAttributes.DIM}>Mosaic welcomes you !</text>
          <text attributes={TextAttributes.DIM}>Mosaic CLI v{VERSION}</text>
          <text attributes={TextAttributes.DIM}>Now are you ready to {isFirstRun ? 'configure' : 'use'} it ?</text>
        </box>
      </box>
      <box marginTop={1}>
        <text attributes={TextAttributes.DIM}>Press Enter to continue...</text>
      </box>
    </box>
  );
}