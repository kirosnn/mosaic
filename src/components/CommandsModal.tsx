import { TextAttributes } from "@opentui/core";
import { commandRegistry } from "../utils/commands";

interface CommandItem {
  name: string;
  usage?: string;
  description: string;
  aliases?: string[];
}

export function CommandModal() {
  const commands = Array.from(commandRegistry.getAll().entries())
    .filter(([name, cmd]) => name === cmd.name)
    .map(([name, cmd]): CommandItem => ({
      name,
      usage: cmd.usage,
      description: cmd.description,
      aliases: cmd.aliases
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <box position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor={"#0c0c0c"}>
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <box flexDirection="column" width="80%" height="80%" backgroundColor="#1a1a1a" padding={2}>
          <box marginBottom={1} flexDirection="row" justifyContent="space-between" width="100%">
            <text attributes={TextAttributes.BOLD}>Available Commands</text>
            <text attributes={TextAttributes.DIM}>Esc to close</text>
          </box>

          <box flexDirection="column" width="100%" flexGrow={1} overflow="hidden">
            <box flexDirection="column" width="100%" overflow="scroll">
              {commands.length === 0 ? (
                <box flexDirection="row" width="100%" marginBottom={1}>
                  <text attributes={TextAttributes.DIM}>No commands available</text>
                </box>
              ) : (
                commands.map((cmd, idx) => (
                  <box key={idx} flexDirection="column" width="100%" marginBottom={1}>
                    <box flexDirection="row" width="100%">
                      <box width={12}>
                        <text fg="#ffca38" attributes={TextAttributes.BOLD}>/{cmd.name}</text>
                      </box>
                      <box flexGrow={1} minWidth={0}>
                        <text>{cmd.description}</text>
                      </box>
                    </box>
                    {cmd.usage && (
                      <box flexDirection="row" width="100%" marginTop={0}>
                        <box width={12}>
                          <text attributes={TextAttributes.DIM}> </text>
                        </box>
                        <box flexGrow={1} minWidth={0}>
                          <text attributes={TextAttributes.DIM}>{cmd.usage}</text>
                        </box>
                      </box>
                    )}
                    {cmd.aliases && cmd.aliases.length > 0 && (
                      <box flexDirection="row" width="100%" marginTop={0}>
                        <box width={12}>
                          <text attributes={TextAttributes.DIM}> </text>
                        </box>
                        <box flexGrow={1} minWidth={0}>
                          <text attributes={TextAttributes.DIM}>Aliases: {cmd.aliases.join(", ")}</text>
                        </box>
                      </box>
                    )}
                  </box>
                ))
              )}
            </box>
          </box>
        </box>
      </box>
    </box>
  );
}
