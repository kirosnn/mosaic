import { describe, expect, it } from 'bun:test';
import { isCompatibilityFailure } from '../subsystemRunner';

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
});
