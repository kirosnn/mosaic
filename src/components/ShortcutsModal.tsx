import { TextAttributes } from "@opentui/core";

interface ShortcutItem {
  keys: string;
  description: string;
}

interface ShortcutsModalProps {
  activeTab: 0 | 1;
}

export function ShortcutsModal({ activeTab }: ShortcutsModalProps) {
  const shortcutsGeneral: ShortcutItem[] = [
    { keys: "Ctrl+P / Alt+P", description: "Open/close this shortcuts panel" },
    { keys: "Alt+V (or Ctrl+V)", description: "Paste from clipboard into the focused input" },
    { keys: "Ctrl+C", description: "Cancel the current request" },
    { keys: "Alt+C (or Cmd+C)", description: "Copy the last assistant message" },
    { keys: "Shift+Tab", description: "Toggle auto-approve for agent changes" },
    { keys: "Enter", description: "Confirm / submit" },
    { keys: "↑/↓ (or j/k)", description: "Navigate lists" },
    { keys: "PageUp/PageDown", description: "Scroll chat faster" },
  ];

  const shortcutsSetup: ShortcutItem[] = [
    { keys: "Esc", description: "Go back to the previous step" },
    { keys: "Enter", description: "Confirm / next step" },
    { keys: "Y / N", description: "Answer Yes/No questions" },
    { keys: "↑/↓ (or j/k)", description: "Navigate provider/model lists" },
    { keys: "Alt+V (or Ctrl+V)", description: "Paste API key into the focused input" },
  ];

  const shortcuts = activeTab === 0 ? shortcutsGeneral : shortcutsSetup;

  return (
    <box position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor={"#0c0c0c"}>
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <box flexDirection="column" width="80%" height="80%" backgroundColor="#1a1a1a" padding={2}>
          <box marginBottom={1} flexDirection="row" justifyContent="space-between" width="100%">
            <text attributes={TextAttributes.BOLD}>Keyboard shortcuts</text>
            <text attributes={TextAttributes.DIM}>Esc to close the page</text>
          </box>

          <box marginBottom={1} flexDirection="row" width="100%">
            <box paddingLeft={1} paddingRight={1} backgroundColor={activeTab === 0 ? '#2a2a2a' : 'transparent'}>
              <text fg={activeTab === 0 ? "#ffca38" : undefined} attributes={activeTab === 0 ? TextAttributes.BOLD : TextAttributes.DIM}>F1 General</text>
            </box>
            <box marginLeft={1} paddingLeft={1} paddingRight={1} backgroundColor={activeTab === 1 ? '#2a2a2a' : 'transparent'}>
              <text fg={activeTab === 1 ? "#ffca38" : undefined} attributes={activeTab === 1 ? TextAttributes.BOLD : TextAttributes.DIM}>F2 Setup</text>
            </box>
          </box>

          <box flexDirection="column" width="100%" flexGrow={1}>
            <box flexDirection="column" width="100%" overflow="scroll">
              {shortcuts.map((s, idx) => (
                <box key={idx} flexDirection="row" width="100%" marginBottom={1}>
                  <box width={22}>
                    <text fg="#ffca38" attributes={TextAttributes.BOLD}>{s.keys}</text>
                  </box>
                  <box flexGrow={1} minWidth={0}>
                    <text attributes={TextAttributes.DIM}>{s.description}</text>
                  </box>
                </box>
              ))}
            </box>
          </box>
        </box>
      </box>
    </box>
  );
}
