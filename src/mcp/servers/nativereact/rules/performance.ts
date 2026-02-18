import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';

const LARGE_BLUR_THRESHOLD_PX = 10;

export const performanceRules: Rule[] = [
  {
    id: 'noInlinePropOnMemoComponent',
    category: 'performance',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanLines(
        file.lines,
        /\w+\s*=\s*\{\s*(?:\(\s*\)\s*=>|function\s*\(|\{(?!\s*\})|\[(?!\s*\]))/,
        'Inline function/object/array prop will cause unnecessary re-renders on memoized components',
        'Define callbacks with useCallback, objects/arrays with useMemo, or move them outside the component.',
        (line) => line.includes('={') && !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'noUsememoSimpleExpression',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useMemo\s*\(\s*\(\s*\)\s*=>\s*(?:['"`\d]|true|false|null|undefined|\w+\s*\+\s*\w+|\w+\s*\?\s*\w+\s*:\s*\w+)\s*,/,
        'useMemo used on a trivial expression',
        'useMemo adds overhead. Only memoize expensive computations or reference-stable values needed by memo components.',
      );
    },
  },
  {
    id: 'noLayoutPropertyAnimation',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /animate\s*=\s*\{\s*\{[^}]*\b(?:width|height|top|left|right|bottom|margin|padding)\s*:/,
        'Animating layout properties (width, height, margin, padding) triggers expensive layout recalculations',
        'Use CSS transforms (translateX, translateY, scale) instead of animating layout properties for better performance.',
      );
    },
  },
  {
    id: 'noTransitionAll',
    category: 'performance',
    severity: 'warning',
    check(file) {
      const fromCss = scanLines(
        file.lines,
        /transition\s*:\s*['"]?all\b/,
        'transition: all animates every CSS property including expensive layout properties',
        'Specify exact properties to transition (e.g. "opacity 0.2s, transform 0.2s") instead of "all".',
      );
      const fromJs = scanContent(
        file.content,
        /transition\s*:\s*['"]all\b/,
        'transition: "all" animates every CSS property',
        'Specify exact properties to transition instead of "all".',
      );
      return [...fromCss, ...fromJs];
    },
  },
  {
    id: 'noGlobalCssVariableAnimation',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /animate\s*=\s*\{\s*\{[^}]*--[\w-]+\s*:/,
        'Animating CSS custom properties (variables) forces style recalculation on all child elements',
        'Animate concrete values directly or use the Web Animations API for CSS variable animations.',
      );
    },
  },
  {
    id: 'noLargeAnimatedBlur',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /blur\s*\(\s*(\d+)(?:\.\d+)?\s*px/,
        m => {
          const px = parseInt(m[1] ?? '0', 10);
          return px > LARGE_BLUR_THRESHOLD_PX
            ? `Large blur radius (${px}px) is expensive to render, especially on mobile`
            : '';
        },
        `Blur values over ${LARGE_BLUR_THRESHOLD_PX}px are computationally expensive. Use smaller blur values or pre-blurred images.`,
      ).filter(v => v.message !== '');
    },
  },
  {
    id: 'noScaleFromZero',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /\bscale\s*:\s*0\b(?!\s*\.)/,
        'scale: 0 causes sub-pixel rendering artifacts and poor visual quality',
        'Use scale: 0.95 combined with opacity: 0 for smoother enter/exit animations.',
      );
    },
  },
  {
    id: 'noPermanentWillChange',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /will-change\s*:\s*(?!auto)[a-z-]+/,
        'Permanent will-change wastes GPU memory on elements that may not need it',
        'Apply will-change dynamically (e.g. on hover/focus) and remove it after the animation completes.',
      );
    },
  },
  {
    id: 'rerenderMemoWithDefaultValue',
    category: 'performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /function\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\})[^)]*\)/,
        'Default empty array/object in function parameters creates a new reference on every call',
        'Move default values outside the component or use useMemo to maintain reference stability.',
      );
    },
  },
  {
    id: 'renderingHydrationNoFlicker',
    category: 'performance',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]*set[A-Z]\w*\s*\([^)]*\)[^}]*\}\s*,\s*\[\s*\]\s*\)/,
        'useEffect with setState on empty deps causes a double-render (hydration flicker)',
        'Use useState initializer function, useSyncExternalStore, or server-side rendering to avoid client-only state initialization.',
      );
    },
  },
  {
    id: 'renderingUsetransitionLoading',
    category: 'performance',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /const\s*\[\s*(?:is)?[Ll]oading\s*,\s*set(?:Is)?[Ll]oading\s*\]\s*=\s*useState\s*\(\s*(?:false|true)\s*\)/,
        'Loading state with useState causes a render for each state transition',
        'Use useTransition for async operations. It lets React defer the update without a separate loading state.',
      );
    },
  },
  {
    id: 'renderingAnimateSvgWrapper',
    category: 'performance',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<(?:motion\.)?svg[^>]*animate[^>]*>/,
        'Animating SVG elements directly can cause layout thrashing',
        'Wrap the SVG in a div/motion.div and animate the wrapper for better performance.',
      );
    },
  },
];
