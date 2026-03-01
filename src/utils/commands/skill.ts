import type { Command } from './types';
import {
  clearMissingActiveSkills,
  clearOneShotSkills,
  createSkillFile,
  ensureSkillsDirectory,
  getActiveSkillsSnapshot,
  getOneShotSkillIds,
  getSkillsByGroup,
  getSkillsByTag,
  getSkillsDirectoryPath,
  getSkillsDirectoryRelativePath,
  getSkillsIndexCache,
  getSkillLintWarnings,
  listWorkspaceSkills,
  resolveSkillReferences,
  searchSkills,
  type SkillLintWarning,
  type WorkspaceSkill,
} from '../skills';

interface ParsedArgs {
  values: string[];
  pickIndex?: number;
}

function parseArgs(tokens: string[]): ParsedArgs {
  const values: string[] = [];
  let pickIndex: number | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] || '';
    if (!token) continue;
    if (token === '--pick') {
      const next = tokens[i + 1];
      if (next && /^\d+$/.test(next)) {
        pickIndex = Math.max(1, Number(next));
        i++;
      }
      continue;
    }
    values.push(token);
  }
  return { values, pickIndex };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function formatSkillLine(skill: WorkspaceSkill): string {
  const tags = skill.tags.length > 0 ? ` [${skill.tags.join(', ')}]` : '';
  return `* ${skill.id} (p${skill.priority}) - ${skill.title}${tags} · /${skill.id}`;
}

function formatSkillChoice(skill: WorkspaceSkill, index: number): string {
  return `${index + 1}. ${skill.id} | ${skill.title} | ${skill.path}`;
}

function formatWarnings(warnings: SkillLintWarning[]): string[] {
  if (warnings.length === 0) return [];
  const lines = ['Warnings:'];
  for (const warning of warnings) {
    lines.push(`- ${warning.skillId}: ${warning.message} (${warning.pattern})`);
  }
  return lines;
}

function formatAmbiguous(ambiguous: Array<{ reference: string; matches: WorkspaceSkill[] }>): string[] {
  const lines: string[] = [];
  for (const entry of ambiguous) {
    lines.push(`Ambiguous "${entry.reference}":`);
    entry.matches.forEach((skill, index) => {
      lines.push(`  ${formatSkillChoice(skill, index)}`);
    });
    lines.push('Use --pick <index> to select one result.');
  }
  return lines;
}

function usageText(): string {
  return [
    'Usage:',
    '/skill list',
    '/skill active',
    '/skill clear',
    '/skill clear missing',
    '/skill show <name> [--pick N]',
    '/skill info <name> [--pick N]',
    '/skill search <query>',
    '/skill pack <tag:<name>|group>',
    '/skill create <name>',
    '/skill path',
    '',
    'Force run a skill directly:',
    '/<skill-id> <optional instructions>',
  ].join('\n');
}

function resolveSingleSkill(name: string, skills: WorkspaceSkill[], pickIndex?: number): {
  skill?: WorkspaceSkill;
  error?: string;
} {
  const resolved = resolveSkillReferences([name], skills, { pickIndex });
  if (resolved.missing.length > 0) {
    return { error: `Skill not found: ${resolved.missing[0]}` };
  }
  if (resolved.ambiguous.length > 0) {
    const lines = formatAmbiguous(resolved.ambiguous);
    return { error: lines.join('\n') };
  }
  const skill = resolved.matches[0];
  if (!skill) return { error: 'Skill resolution failed.' };
  return { skill };
}

export const skillCommand: Command = {
  name: 'skill',
  description: 'Manage workspace skills in ~/.mosaic/skills',
  usage: '/skill [list|active|clear|show|info|search|pack|create|path]',
  aliases: ['skills', 'sk'],
  execute: (args: string[]) => {
    const action = (args[0] || 'list').toLowerCase();
    const parsed = parseArgs(args.slice(1));
    const knownSkills = listWorkspaceSkills();
    const snapshot = getActiveSkillsSnapshot(knownSkills);

    if (action === 'list' || action === 'ls') {
      if (knownSkills.length === 0) {
        return {
          success: true,
          content: `Skills directory: ${getSkillsDirectoryRelativePath()}\nNo skill files found.\nUse /skill create <name> to create one.`,
          shouldAddToHistory: false,
        };
      }

      const lines: string[] = [];
      const cache = getSkillsIndexCache();
      lines.push(`Skills directory: ${getSkillsDirectoryRelativePath()}`);
      lines.push(`Skills: ${knownSkills.length}`);
      lines.push(`Active by default: ${snapshot.activeSkills.length}`);
      if (cache) {
        lines.push(`Cache: ${cache.entries.length} entries (${cache.generatedAt})`);
      } else {
        lines.push('Cache: unavailable');
      }
      if (snapshot.missingIds.length > 0) lines.push(`Legacy missing IDs: ${snapshot.missingIds.join(', ')}`);
      if (snapshot.ambiguousIds.length > 0) lines.push(`Legacy ambiguous IDs: ${snapshot.ambiguousIds.map((entry) => entry.id).join(', ')}`);
      const oneShot = getOneShotSkillIds();
      if (oneShot.length > 0) lines.push(`One-shot queued: ${oneShot.join(', ')}`);
      lines.push('');
      lines.push('Skills:');
      for (const skill of knownSkills) {
        lines.push(formatSkillLine(skill));
      }
      lines.push('');
      lines.push('Force a skill with /<skill-id> <instructions>.');
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'active') {
      const lines: string[] = [];
      if (snapshot.activeSkills.length === 0) {
        lines.push('No skills found.');
      } else {
        lines.push('Auto-active skills:');
        for (const skill of snapshot.activeSkills) {
          lines.push(`- ${skill.id} | ${skill.title} | ${skill.path}`);
        }
      }

      const oneShotIds = getOneShotSkillIds();
      if (oneShotIds.length > 0) {
        lines.push('');
        lines.push(`One-shot queued: ${oneShotIds.join(', ')}`);
      }

      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'use' || action === 'on' || action === 'enable' || action === 'off' || action === 'disable' || action === 'remove') {
      return {
        success: false,
        content: 'Skills are auto-enabled by default. To force one, use /<skill-id> <instructions>.',
        shouldAddToHistory: false,
      };
    }

    if (action === 'clear' || action === 'none' || action === 'reset') {
      const mode = (parsed.values[0] || '').toLowerCase();
      if (mode === 'missing') {
        const removed = clearMissingActiveSkills();
        if (removed.removedIds.length === 0) {
          return {
            success: true,
            content: 'No legacy missing IDs to clear.',
            shouldAddToHistory: false,
          };
        }
        return {
          success: true,
          content: `Removed legacy missing IDs: ${removed.removedIds.join(', ')}`,
          shouldAddToHistory: false,
        };
      }

      clearOneShotSkills();
      return {
        success: true,
        content: 'Cleared one-shot queued skills.',
        shouldAddToHistory: false,
      };
    }

    if (action === 'show' || action === 'cat') {
      const target = parsed.values.join(' ').trim();
      if (!target) {
        return {
          success: false,
          content: `Missing skill name.\n${usageText()}`,
          shouldAddToHistory: false,
        };
      }
      const resolved = resolveSingleSkill(target, knownSkills, parsed.pickIndex);
      if (!resolved.skill) {
        return {
          success: false,
          content: resolved.error || 'Skill resolution failed.',
          shouldAddToHistory: false,
        };
      }

      const skill = resolved.skill;
      const lines = [
        `Skill: ${skill.title}`,
        `Id: ${skill.id}`,
        `Path: ${skill.path}`,
        `Priority: ${skill.priority}`,
        '',
        truncateText(skill.content, 20000) || '[empty]',
      ];
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'info') {
      const target = parsed.values.join(' ').trim();
      if (!target) {
        return {
          success: false,
          content: `Missing skill name.\n${usageText()}`,
          shouldAddToHistory: false,
        };
      }
      const resolved = resolveSingleSkill(target, knownSkills, parsed.pickIndex);
      if (!resolved.skill) {
        return {
          success: false,
          content: resolved.error || 'Skill resolution failed.',
          shouldAddToHistory: false,
        };
      }
      const skill = resolved.skill;
      const cache = getSkillsIndexCache();
      const cacheEntry = cache?.entries.find((entry) => entry.path === skill.path);
      const warnings = formatWarnings(getSkillLintWarnings(skill));
      const lines = [
        `Id: ${skill.id}`,
        `Title: ${skill.title}`,
        `Path: ${skill.path}`,
        `Group: ${skill.group}`,
        `Priority: ${skill.priority}`,
        `Tags: ${skill.tags.join(', ') || 'none'}`,
        `Requires: ${skill.requires.join(', ') || 'none'}`,
        `Summary: ${skill.summary || 'none'}`,
        `On activate: ${skill.onActivateRun ? 'run' : 'off'}`,
        `On activate task: ${skill.onActivatePrompt || 'none'}`,
        `Size: ${skill.sizeBytes} bytes`,
        `Updated: ${new Date(skill.updatedAt).toISOString()}`,
        `Cache hash: ${cacheEntry?.contentHash || 'n/a'}`,
      ];
      if (warnings.length > 0) {
        lines.push('');
        lines.push(...warnings);
      }
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'search') {
      const query = parsed.values.join(' ').trim();
      if (!query) {
        return {
          success: false,
          content: `Missing search query.\n${usageText()}`,
          shouldAddToHistory: false,
        };
      }
      const results = searchSkills(query, knownSkills);
      if (results.length === 0) {
        return {
          success: true,
          content: `No skills found for "${query}".`,
          shouldAddToHistory: false,
        };
      }
      const lines = [`Search results (${results.length}):`];
      for (const skill of results) {
        lines.push(`- ${skill.id} | ${skill.title} | ${skill.path}`);
      }
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'pack') {
      const selector = (parsed.values[0] || '').trim();
      if (!selector) {
        return {
          success: false,
          content: `Missing pack selector.\nUse tag:<name> or a group name (local/team/vendor).\n${usageText()}`,
          shouldAddToHistory: false,
        };
      }

      const byTag = selector.toLowerCase().startsWith('tag:');
      const value = byTag ? selector.slice(4).trim() : selector;
      const packSkills = byTag ? getSkillsByTag(value, knownSkills) : getSkillsByGroup(value, knownSkills);
      if (packSkills.length === 0) {
        return {
          success: false,
          content: `No skills matched pack selector "${selector}".`,
          shouldAddToHistory: false,
        };
      }

      const lines = [`Pack "${selector}" matched ${packSkills.length} skills:`];
      for (const skill of packSkills) {
        lines.push(`- ${skill.id} | ${skill.title} | /${skill.id}`);
      }
      lines.push('');
      lines.push(`Force one directly, example: /${packSkills[0]!.id} your instructions`);
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    if (action === 'create' || action === 'new') {
      const name = parsed.values.join(' ').trim();
      if (!name) {
        return {
          success: false,
          content: `Missing skill name.\n${usageText()}`,
          shouldAddToHistory: false,
        };
      }
      const created = createSkillFile(name);
      if (!created.success) {
        return {
          success: false,
          content: created.reason || 'Failed to create skill.',
          shouldAddToHistory: false,
        };
      }
      return {
        success: true,
        content: `Created skill ${created.id} at ${created.path}. Force it with /${created.id} <instructions>.`,
        shouldAddToHistory: false,
      };
    }

    if (action === 'path' || action === 'dir') {
      ensureSkillsDirectory();
      return {
        success: true,
        content: `Skills directory:\n- Relative: ${getSkillsDirectoryRelativePath()}\n- Absolute: ${getSkillsDirectoryPath()}`,
        shouldAddToHistory: false,
      };
    }

    return {
      success: false,
      content: `Unknown subcommand "${action}".\n${usageText()}`,
      shouldAddToHistory: false,
    };
  },
};
