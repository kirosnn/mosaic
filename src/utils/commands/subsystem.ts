import type { Command, SelectOption } from "./types";
import { getPreferredSubsystem, setPreferredSubsystem } from "../config";
import {
  discoverSubsystems,
  getEffectiveSubsystem,
} from "../subsystemDiscovery";

export const subsystemCommand: Command = {
  name: "subsystem",
  description: "List or switch shell subsystems for bash tool execution",
  usage: "/subsystem [id]",
  aliases: ["shell", "sh"],
  execute: async (args: string[]) => {
    const subsystems = await discoverSubsystems();
    const current = getPreferredSubsystem();
    const effective = await getEffectiveSubsystem(current);

    if (args.length === 0) {
      const options: SelectOption[] = subsystems.map((s) => {
        const isPreferred = s.id === current;
        const isEffective = s.id === effective.id;

        let badge = isPreferred ? "Actual" : undefined;
        if (isEffective && !isPreferred) {
          badge = "Effective (Auto)";
        }

        if (!s.available && s.id !== "auto") {
          badge = "Unavailable";
        }

        return {
          name: s.id,
          description: s.label + (s.details ? ` (${s.details})` : ""),
          value: s.id,
          active: isPreferred,
          disabled: !s.available && s.id !== "auto",
          badge,
        };
      });

      const currentInfo = `Preferred: **${current}** | Effective: **${effective.id}** (${effective.label})`;

      return {
        success: true,
        content: currentInfo,
        showSelectMenu: {
          title: "Select Shell Subsystem",
          options,
          onSelect: (value: string) => {
            const chosen = subsystems.find((s) => s.id === value);
            if (chosen) {
              setPreferredSubsystem(value);
              return {
                confirmationMessage: `Shell subsystem set to ${chosen.label} (${value}).`,
              };
            }
            return {
              confirmationMessage: `Unknown subsystem: ${value}`,
            };
          },
        },
      };
    }

    const targetId = args[0]!;
    const known = subsystems.find((s) => s.id === targetId);

    if (!known) {
      return {
        success: false,
        content: `Unknown subsystem "${targetId}". Available: ${subsystems.map((s) => s.id).join(", ")}`,
      };
    }

    if (!known.available && known.id !== "auto") {
      return {
        success: false,
        content: `Subsystem "${targetId}" (${known.label}) is not available on this machine.`,
      };
    }

    setPreferredSubsystem(targetId);
    return {
      success: true,
      content: `Shell subsystem set to ${known.label} (${targetId}).`,
    };
  },
};
