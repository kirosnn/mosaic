import type { Rule } from '../types.js';
import { scanContent } from './utils.js';

export const clientRules: Rule[] = [
  {
    id: 'clientPassiveEventListeners',
    category: 'client',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /addEventListener\s*\(\s*['"`](?:scroll|touchstart|touchmove|wheel|mousewheel)['"`]\s*,[^,)]+\)/,
        m => {
          const hasPassive = m[0].includes('passive');
          if (hasPassive) return '';
          return `Event listener for "${(m[0].match(/['"\`](\w+)['"\`]/) || [])[1]}" without { passive: true }`;
        },
        'Add { passive: true } to scroll/touch event listeners to improve scroll performance and avoid browser warnings.',
      ).filter(v => v.message !== '');
    },
  },
];
