import { TextAttributes } from "@opentui/core";

export interface ToolGroupEntry {
  key: string;
  toolName?: string;
  label: string;
  result?: string;
  success?: boolean;
  isRunning?: boolean;
}

interface ToolGroupPanelProps {
  goal: string;
  entries: ToolGroupEntry[];
  collapsed: boolean;
  isActive?: boolean;
  blinkOn?: boolean;
  onToggle?: () => void;
}

export function ToolGroupPanel({
  goal,
  entries,
  collapsed,
  isActive = false,
  blinkOn = false,
  onToggle,
}: ToolGroupPanelProps) {
  const countLabel = `${entries.length} tool${entries.length > 1 ? "s" : ""}`;
  const bulletText = "• ";
  const bulletColor = isActive
    ? blinkOn
      ? "#ffffff"
      : "#808080"
    : "#9a9a9a";

  return (
    <box flexDirection="column" width="100%">
      <box height={1} width="100%" />
      <box flexDirection="row" width="100%" onMouseDown={onToggle}>
        <text fg={bulletColor}>{bulletText}</text>
        <text attributes={TextAttributes.DIM}>
          {`${goal} (${countLabel}${collapsed ? ", click to expand" : ""})`}
        </text>
      </box>

      {!collapsed && entries.length > 0 && (
        <box flexDirection="column" width="100%" paddingLeft={2}>
          {entries.map((entry) => {
            const arrowColor = entry.isRunning
              ? "white"
              : entry.success === false
                ? "#ff3838"
                : "#44aa88";

            return (
              <box key={entry.key} flexDirection="row" width="100%">
                <text fg={arrowColor}>{"➔  "}</text>
                <text attributes={TextAttributes.DIM}>
                  {`${entry.label}${entry.result ? ` : ${entry.result}` : ""}`}
                </text>
              </box>
            );
          })}
        </box>
      )}
      <box height={1} width="100%" />
    </box>
  );
}
