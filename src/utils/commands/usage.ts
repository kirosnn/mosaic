import type { Command } from "./types";
import { buildUsageReport, renderUsageSummary } from "../usage";

function parseUsageFlags(args: string[]): { includeAllWorkspaces: boolean; refreshPricing: boolean } {
  let includeAllWorkspaces = true;
  let refreshPricing = false;

  for (const arg of args) {
    const token = String(arg || "").trim().toLowerCase();
    if (!token) continue;
    if (token === "--workspace" || token === "-w") {
      includeAllWorkspaces = false;
      continue;
    }
    if (token === "--all" || token === "-a") {
      includeAllWorkspaces = true;
      continue;
    }
    if (token === "--refresh" || token === "-r") {
      refreshPricing = true;
    }
  }

  return { includeAllWorkspaces, refreshPricing };
}

export const usageCommand: Command = {
  name: "usage",
  description: "Show Mosaic token and cost usage from history",
  usage: "/usage [--workspace|--all] [--refresh]",
  aliases: ["costs", "stats"],
  execute: async (args: string[]) => {
    const flags = parseUsageFlags(args);
    const report = await buildUsageReport({
      includeAllWorkspaces: flags.includeAllWorkspaces,
      workspace: process.cwd(),
      refreshPricing: flags.refreshPricing,
    });

    return {
      success: true,
      content: renderUsageSummary(report),
      shouldAddToHistory: false,
      openUsageView: true,
      usageReport: report,
    };
  },
};
