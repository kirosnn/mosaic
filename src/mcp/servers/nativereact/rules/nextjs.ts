import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';
import { basename } from 'path';

export const nextjsRules: Rule[] = [
  {
    id: 'nextjsNoImgElement',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanLines(
        file.lines,
        /<img\s/,
        'Use next/image <Image> instead of <img>',
        'next/image provides automatic optimization, lazy loading, and proper sizing. Import from "next/image".',
        (line) => !line.trimStart().startsWith('//') && !line.includes('next/image'),
      );
    },
  },
  {
    id: 'nextjsAsyncClientComponent',
    category: 'nextjs',
    severity: 'error',
    frameworks: ['nextjs'],
    check(file) {
      if (!file.isClientComponent) return [];
      return scanContent(
        file.content,
        /^(?:export\s+(?:default\s+)?)?async\s+function\s+[A-Z]/m,
        'Async Client Components are not supported in Next.js',
        'Remove the async keyword. Fetch data in a Server Component parent and pass it as props, or use SWR/React Query.',
      );
    },
  },
  {
    id: 'nextjsNoAElement',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanLines(
        file.lines,
        /<a\s+(?:[^>]*\s)?href\s*=/,
        'Use next/link <Link> instead of <a href>',
        'next/link enables client-side navigation with prefetching. Import from "next/link".',
        (line) => !line.trimStart().startsWith('//') && !line.includes('next/link') && !line.includes('mailto:') && !line.includes('tel:'),
      );
    },
  },
  {
    id: 'nextjsNoUseSearchParamsWithoutSuspense',
    category: 'nextjs',
    severity: 'error',
    frameworks: ['nextjs'],
    check(file) {
      if (!file.content.includes('useSearchParams')) return [];
      if (file.content.includes('<Suspense')) return [];
      return scanContent(
        file.content,
        /\buseSearchParams\s*\(\s*\)/,
        'useSearchParams() without a Suspense boundary causes the entire page to opt into client-side rendering',
        'Wrap the component using useSearchParams in a <Suspense> boundary with a fallback.',
      );
    },
  },
  {
    id: 'nextjsNoClientFetchForServerData',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    check(file) {
      if (!file.isClientComponent) return [];
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,500}?\bfetch\s*\(/,
        'Fetching data in a Client Component useEffect misses server-side benefits',
        'Move data fetching to a Server Component parent, or use a data-fetching library like SWR or React Query.',
      );
    },
  },
  {
    id: 'nextjsMissingMetadata',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    check(file) {
      const name = basename(file.path);
      if (name !== 'page.tsx' && name !== 'page.jsx' && name !== 'page.ts' && name !== 'page.js') return [];
      const hasMetadata = file.content.includes('export const metadata') || file.content.includes('generateMetadata');
      if (hasMetadata) return [];
      return [{
        line: 1,
        column: 1,
        message: 'Next.js page missing metadata export',
        help: 'Add `export const metadata = { title, description }` or a `generateMetadata` function for SEO.',
      }];
    },
  },
  {
    id: 'nextjsNoClientSideRedirect',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    check(file) {
      if (!file.isClientComponent) return [];
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,400}?router\.(?:push|replace)\s*\(/,
        'Client-side redirect in useEffect is fragile and misses server rendering',
        'Use the Next.js redirect() function in a Server Component or middleware for reliable redirects.',
      );
    },
  },
  {
    id: 'nextjsNoRedirectInTryCatch',
    category: 'nextjs',
    severity: 'error',
    frameworks: ['nextjs'],
    check(file) {
      return scanContent(
        file.content,
        /try\s*\{[^}]*\bredirect\s*\([^)]*\)[^}]*\}/,
        'redirect() inside try/catch will not work — redirect() throws internally',
        'Call redirect() outside the try block, or use a flag variable and redirect after the try/catch.',
      );
    },
  },
  {
    id: 'nextjsImageMissingSizes',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<Image[^>]*\bfill\b[^>]*(?!sizes)[^>]*>/,
        'next/image with fill prop but no sizes attribute downloads the largest possible image',
        'Add a sizes attribute: sizes="(max-width: 768px) 100vw, 50vw" to help the browser choose the right image size.',
      );
    },
  },
  {
    id: 'nextjsNoNativeScript',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanLines(
        file.lines,
        /<script\s/,
        'Use next/script <Script> instead of native <script>',
        'next/script provides loading strategies (beforeInteractive, afterInteractive, lazyOnload) for optimized script loading.',
        (line) => !line.includes('next/script') && !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'nextjsInlineScriptMissingId',
    category: 'nextjs',
    severity: 'error',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<Script[^>]*(?:dangerouslySetInnerHTML|children)[^>]*(?!id\s*=)[^>]*>/,
        'Inline <Script> component requires an id prop',
        'Add a unique id prop to inline Script components: <Script id="my-script">.',
      );
    },
  },
  {
    id: 'nextjsNoFontLink',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<link[^>]*href\s*=\s*['"]https?:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/,
        'Loading Google Fonts via <link> is slower than next/font',
        'Use next/font/google for automatic font optimization with zero layout shift and no external network requests.',
      );
    },
  },
  {
    id: 'nextjsNoCssLink',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<link[^>]*rel\s*=\s*['"]stylesheet['"][^>]*href\s*=\s*['"][^'"]*\.css['"]/,
        'External CSS <link> bypasses Next.js CSS optimization',
        'Import CSS files directly: import "./styles.css" or use CSS Modules for scoped styles.',
      );
    },
  },
  {
    id: 'nextjsNoHeadImport',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    check(file) {
      return scanLines(
        file.lines,
        /from\s+['"]next\/head['"]/,
        'next/head is for the Pages Router; use the Metadata API in the App Router',
        'Export a metadata object or generateMetadata function from your layout/page instead of using next/head.',
      );
    },
  },
  {
    id: 'nextjsNoPolyfillScript',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /<Script[^>]*src\s*=\s*['"][^'"]*polyfill[^'"]*['"]/,
        'Next.js includes polyfills automatically — manual polyfill scripts are redundant',
        'Remove the polyfill script. Next.js handles browser polyfills automatically based on your browserslist config.',
      );
    },
  },
  {
    id: 'nextjsNoSideEffectInGetHandler',
    category: 'nextjs',
    severity: 'warning',
    frameworks: ['nextjs'],
    check(file) {
      const name = basename(file.path);
      if (name !== 'route.ts' && name !== 'route.js' && name !== 'route.tsx') return [];
      return scanContent(
        file.content,
        /export\s+(?:async\s+)?function\s+GET\s*\([^)]*\)\s*\{[\s\S]{0,600}?(?:db\.|prisma\.|fetch\s*\()[^}]*\}/,
        'GET route handler with side effects (writes, mutations) violates HTTP semantics',
        'GET handlers should be read-only. Use POST/PUT/DELETE/PATCH handlers for mutations.',
      );
    },
  },
];
