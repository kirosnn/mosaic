import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey|secret[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|password|passwd|pwd)\s*(?:=|:)\s*['"`]([^'"`]{8,})['"`]/i,
  /(?:OPENAI|ANTHROPIC|STRIPE|TWILIO|SENDGRID|MAILGUN|GITHUB|GITLAB|AWS|AZURE|GCP|FIREBASE)_(?:KEY|SECRET|TOKEN|API_KEY)\s*(?:=|:)\s*['"`]([^'"`]{8,})['"`]/,
];

const SERVER_FILE_PATTERN =
  /(?:^|[\\/])(?:server|middleware|route|api)\.(?:tsx|jsx|ts|js|mts|mjs|cts|cjs)$/i;
const SERVER_PATH_SEGMENT_PATTERN = /[\\/](?:api|server|backend|mcp|agent|scripts?)[\\/]/i;

function isLikelyClientSideSource(filePath: string, ext: string, isClientComponent: boolean): boolean {
  if (isClientComponent) return true;
  if (SERVER_FILE_PATTERN.test(filePath)) return false;
  if (SERVER_PATH_SEGMENT_PATTERN.test(filePath)) return false;
  return ext === '.tsx' || ext === '.jsx';
}

export const securityRules: Rule[] = [
  {
    id: 'noEval',
    category: 'security',
    severity: 'error',
    check(file) {
      return scanLines(
        file.lines,
        /\beval\s*\(|\bnew\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/,
        m => `Unsafe code execution: ${m[0].trim()}`,
        'Use safer alternatives: JSON.parse for data, arrow functions for callbacks, avoid dynamic code evaluation.',
      );
    },
  },
  {
    id: 'noSecretsInClientCode',
    category: 'security',
    severity: 'error',
    check(file, projectInfo) {
      const violations = [];
      for (const pattern of SECRET_PATTERNS) {
        const found = scanContent(file.content, pattern, 'Hardcoded secret detected in source code', 'Store secrets in environment variables and access them server-side. Never expose secrets in client-side code.');
        violations.push(...found);
      }

      if (isLikelyClientSideSource(file.path, file.ext, file.isClientComponent)) {
        const clientEnvPattern = /process\.env\.(?!NEXT_PUBLIC_|REACT_APP_|VITE_)([A-Z_]{4,})/g;
        const envFound = scanContent(
          file.content,
          clientEnvPattern,
          m => `Server-side env var "${m[1]}" may be exposed in client bundle`,
          'Only use NEXT_PUBLIC_/REACT_APP_/VITE_ prefixed env vars in client components.',
        );
        violations.push(...envFound);
      }

      return violations;
    },
  },
];
