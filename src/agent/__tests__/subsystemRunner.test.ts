import { describe, expect, it } from 'bun:test';
import {
  isCompatibilityFailure,
  shellQuotePosix,
  toWslPath,
} from '../subsystemRunner';

describe('subsystemRunner', () => {
  describe('isCompatibilityFailure', () => {
    it('should identify shell not found as compatibility failure', () => {
      expect(isCompatibilityFailure("'pwsh.exe' is not recognized", 'pwsh')).toBe(true);
      expect(isCompatibilityFailure("command not found: wsl.exe", 'wsl')).toBe(true);
      expect(isCompatibilityFailure("The term 'pwsh.exe' is not recognized as the name of a cmdlet", 'pwsh')).toBe(true);
    });

    it('should identify syntax errors as compatibility failure', () => {
      expect(isCompatibilityFailure("syntax error near unexpected token", 'bash')).toBe(true);
    });

    it('should NOT identify logical failures as compatibility failure', () => {
      expect(isCompatibilityFailure("git: 'status' is not a git command", 'powershell')).toBe(false);
      expect(isCompatibilityFailure("fatal: not a git repository", 'pwsh')).toBe(false);
      expect(isCompatibilityFailure("cat: file.txt: No such file or directory", 'bash')).toBe(false);
    });
  });

  describe('WSL cwd helpers', () => {
    it('converts Windows drive paths to WSL paths', () => {
      expect(toWslPath(String.raw`C:\Users\Nassim\Projects\mosaic`)).toBe(
        '/mnt/c/Users/Nassim/Projects/mosaic',
      );
    });

    it('POSIX-quotes WSL cwd values', () => {
      expect(shellQuotePosix('/mnt/c/Users/Nassim/Projects/mosaic')).toBe(
        "'/mnt/c/Users/Nassim/Projects/mosaic'",
      );
    });

    it('keeps paths containing spaces shell-safe', () => {
      const wslPath = toWslPath(String.raw`C:\Users\Nassim\My Projects\mosaic`);
      expect(wslPath).toBe('/mnt/c/Users/Nassim/My Projects/mosaic');
      expect(shellQuotePosix(wslPath)).toBe(
        "'/mnt/c/Users/Nassim/My Projects/mosaic'",
      );
    });

    it('escapes single quotes in POSIX shell values', () => {
      expect(shellQuotePosix("/mnt/c/Users/Nassim/O'Brien")).toBe(
        "'/mnt/c/Users/Nassim/O'\\''Brien'",
      );
    });
  });
});
