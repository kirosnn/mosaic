import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';

const HEAVY_LIBRARIES = [
  { pattern: /from\s+['"]moment['"]/, name: 'moment.js', size: '~300kb', alt: 'date-fns or dayjs (~7kb)' },
  { pattern: /from\s+['"]lodash['"]|require\s*\(\s*['"]lodash['"]\s*\)/, name: 'lodash (full)', size: '~72kb', alt: 'specific lodash functions: import cloneDeep from "lodash/cloneDeep"' },
  { pattern: /from\s+['"]rxjs['"](?!\/)/, name: 'rxjs (full)', size: '~200kb', alt: 'specific rxjs imports: import { map } from "rxjs/operators"' },
  { pattern: /from\s+['"]@mui\/material['"](?!\/)/, name: '@mui/material (full)', size: '~500kb', alt: 'specific MUI components: import Button from "@mui/material/Button"' },
];

export const bundleSizeRules: Rule[] = [
  {
    id: 'noBarrelImport',
    category: 'bundle-size',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /from\s+['"]([^'"]+\/index)['"]|from\s+['"](\.[./]*)['"]/,
        m => `Barrel import from "${m[1] || m[2]}" may prevent tree-shaking`,
        'Import specific exports rather than from barrel/index files to enable proper tree-shaking.',
        (line) => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'noMoment',
    category: 'bundle-size',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /from\s+['"]moment['"]|require\s*\(\s*['"]moment['"]\s*\)/,
        'moment.js adds ~300kb to the bundle',
        'Replace moment.js with date-fns (~13kb tree-shakeable) or dayjs (~7kb) for modern date handling.',
        (line) => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'noFullLodashImport',
    category: 'bundle-size',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /import\s+(?:_|\w+)\s+from\s+['"]lodash['"]|require\s*\(\s*['"]lodash['"]\s*\)/,
        'Full lodash import adds ~72kb. Use individual function imports.',
        'Import specific functions: import cloneDeep from "lodash/cloneDeep" or use lodash-es for tree-shaking.',
        (line) => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'preferDynamicImport',
    category: 'bundle-size',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /import\s+\w+\s+from\s+['"](?:react-pdf|@pdf-lib\/\w+|docx|xlsx|exceljs|pdfmake|jspdf|html2canvas|three|@babylonjs|cannon-es|monaco-editor|codemirror|prismjs|highlight\.js)['"]/,
        m => `Heavy library imported statically: ${m[0].match(/from\s+['"]([^'"]+)['"]/)?.[1]}`,
        'Use React.lazy() + Suspense or next/dynamic for heavy libraries to split them into separate chunks loaded on demand.',
        (line) => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'useLazyMotion',
    category: 'bundle-size',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /import\s+\{[^}]*\bmotion\b[^}]*\}\s+from\s+['"]framer-motion['"]/,
        'Importing { motion } from framer-motion includes the full library (~80kb)',
        'Use LazyMotion + domAnimation + "m" components to reduce framer-motion to ~30kb: import { LazyMotion, domAnimation, m } from "framer-motion".',
        (line) => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'noUndeferredThirdParty',
    category: 'bundle-size',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<script\s+src\s*=\s*['"][^'"]+['"]\s*(?!(?:[^>]*\b(?:defer|async)\b))[^>]*>/,
        'Synchronous third-party <script> blocks page rendering',
        'Add defer or async attribute to third-party scripts: <script src="..." defer>.',
      );
    },
  },
];
