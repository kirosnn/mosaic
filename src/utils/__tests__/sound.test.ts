import { describe, expect, it } from 'bun:test';
import { getSoundCommandForPlatform } from '../sound';

describe('UI sounds', () => {
  it('uses native Windows system sounds', () => {
    const command = getSoundCommandForPlatform('attention', 'win32');

    expect(command?.command).toBe('powershell.exe');
    expect(command?.args.join(' ')).toContain('SoundPlayer');
    expect(command?.args.join(' ')).toContain('Speech On.wav');
    expect(command?.args.join(' ')).not.toContain('1..2');
    expect(command?.args.join(' ')).toContain('[console]::beep');
  });

  it('uses tada for Windows completion sounds', () => {
    const command = getSoundCommandForPlatform('done', 'win32');

    expect(command?.args.join(' ')).toContain('tada.wav');
  });

  it('uses native macOS system sounds', () => {
    const command = getSoundCommandForPlatform('done', 'darwin');

    expect(command).toEqual({
      command: 'afplay',
      args: ['/System/Library/Sounds/Glass.aiff'],
    });
  });

  it('falls back to the terminal bell on other platforms', () => {
    expect(getSoundCommandForPlatform('done', 'linux')).toBeNull();
  });
});
