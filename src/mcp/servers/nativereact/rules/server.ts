import type { Rule } from '../types.js';
import { scanContent } from './utils.js';

const AUTH_CHECK_PATTERNS = [
  /auth\s*\(\s*\)/,
  /getSession\s*\(\s*\)/,
  /currentUser\s*\(\s*\)/,
  /verifyToken\s*\(/,
  /requireAuth\s*\(/,
  /checkAuth\s*\(/,
  /session\.user/,
  /cookies\(\).*token/,
];

export const serverRules: Rule[] = [
  {
    id: 'serverAuthActions',
    category: 'server',
    severity: 'error',
    check(file) {
      if (!file.content.includes("'use server'") && !file.content.includes('"use server"')) return [];

      const violations = [];
      const actionPattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]{0,600}?)\}/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(actionPattern.source, 'g');

      while ((m = re.exec(file.content)) !== null) {
        const name = m[1];
        const body = m[2];

        if (!name || !body) continue;
        if (/^(?:get|fetch|load|read|list|find)/i.test(name)) continue;

        const firstStatements = body.slice(0, 300);
        const hasAuthCheck = AUTH_CHECK_PATTERNS.some(p => p.test(firstStatements));

        if (!hasAuthCheck) {
          const before = file.content.slice(0, m.index);
          const line = (before.match(/\n/g) || []).length + 1;
          violations.push({
            line,
            column: 1,
            message: `Server action "${name}" has no auth check at the start`,
            help: 'Add an auth check as the first statement in every server action that mutates data. Example: const session = await auth(); if (!session) throw new Error("Unauthorized");',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'serverAfterNonblocking',
    category: 'server',
    severity: 'warning',
    check(file) {
      if (!file.content.includes("'use server'") && !file.content.includes('"use server"')) return [];
      return scanContent(
        file.content,
        /(?:console\.log|analytics\.|posthog\.|mixpanel\.|segment\.)\s*\(/,
        'Blocking logging/analytics call in server code delays the response',
        'Wrap non-critical side effects in the after() function from "next/server" to run them after the response is sent.',
      );
    },
  },
];
