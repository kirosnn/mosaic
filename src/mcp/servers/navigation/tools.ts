import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Page } from 'playwright';
import { ensureContext, ensurePage, registerPage } from './browser.js';
import { randomDelay } from './utils.js';

type SearchEngine = 'duckduckgo' | 'google' | 'bing';

interface SearchResult {
    text: string;
    href: string;
    snippet: string;
}

interface EngineConfig {
    buildUrl: (query: string) => string;
    extract: (page: Page, limit: number) => Promise<SearchResult[]>;
}

async function resolveRedirects(page: Page, results: SearchResult[]): Promise<SearchResult[]> {
    return page.evaluate((results) => {
        return results.map(r => {
            try {
                const url = new URL(r.href);
                if (url.hostname.includes('bing.com') && url.pathname === '/ck/a') {
                    const u = url.searchParams.get('u');
                    if (u) {
                        const decoded = atob(u.replace(/^a1/, ''));
                        if (decoded.startsWith('http')) return { ...r, href: decoded };
                    }
                }
            } catch { }
            return r;
        });
    }, results);
}

const engines: Record<SearchEngine, EngineConfig> = {
    bing: {
        buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        extract: async (page, limit) => {
            const raw = await page.evaluate((limit) => {
                const items: { text: string; href: string; snippet: string }[] = [];
                const results = document.querySelectorAll('.b_algo');

                for (const el of Array.from(results)) {
                    if (items.length >= limit) break;

                    const linkEl = el.querySelector('h2 a');
                    const snippetEl = el.querySelector('.b_caption p, p');

                    const text = linkEl?.textContent?.trim();
                    const href = linkEl?.getAttribute('href');
                    const snippet = snippetEl?.textContent?.trim() || '';

                    if (text && href && href.startsWith('http')) {
                        items.push({ text, href, snippet });
                    }
                }
                return items;
            }, limit);
            return resolveRedirects(page, raw);
        },
    },
    duckduckgo: {
        buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
        extract: async (page, limit) => {
            return page.evaluate((limit) => {
                const items: { text: string; href: string; snippet: string }[] = [];
                const selectors = ['article[data-testid="result"]', '.result', '.web-result', '.results .result__body'];

                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length === 0) continue;

                    for (const el of Array.from(elements)) {
                        if (items.length >= limit) break;

                        const titleEl = el.querySelector('h2 a, a[data-testid="result-title-a"], .result__a');
                        const snippetEl = el.querySelector('[data-result="snippet"], .result__snippet, span');

                        const text = titleEl?.textContent?.trim();
                        const href = titleEl?.getAttribute('href');
                        const snippet = snippetEl?.textContent?.trim() || '';

                        if (text && href && href.startsWith('http')) {
                            items.push({ text, href, snippet });
                        }
                    }
                    if (items.length > 0) break;
                }
                return items;
            }, limit);
        },
    },
    google: {
        buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=14`,
        extract: async (page, limit) => {
            return page.evaluate((limit) => {
                const items: { text: string; href: string; snippet: string }[] = [];
                const results = document.querySelectorAll('#search .g');

                for (const el of Array.from(results)) {
                    if (items.length >= limit) break;

                    const titleEl = el.querySelector('h3');
                    const linkEl = el.querySelector('a');
                    const snippetEl = el.querySelector('[style*="-webkit-line-clamp"], .VwiC3b, div[style*="line-height"]');

                    const text = titleEl?.textContent?.trim();
                    const href = linkEl?.getAttribute('href');
                    const snippet = snippetEl?.textContent?.trim() || '';

                    if (text && href && href.startsWith('http')) {
                        items.push({ text, href, snippet });
                    }
                }
                return items;
            }, limit);
        },
    },
};

async function extractFallbackResults(page: Page, limit: number): Promise<SearchResult[]> {
    return page.evaluate((limit) => {
        const items: { text: string; href: string; snippet: string }[] = [];
        const seen = new Set<string>();
        const links = document.querySelectorAll('a[href^="http"]');

        for (const link of Array.from(links)) {
            if (items.length >= limit) break;

            const href = link.getAttribute('href');
            if (!href || seen.has(href)) continue;

            try {
                const host = new URL(href).hostname;
                if (['google.', 'bing.', 'duckduckgo.', 'yahoo.'].some(d => host.includes(d))) continue;
            } catch { continue; }

            const text = link.textContent?.trim();
            if (!text || text.length < 3) continue;

            seen.add(href);
            const parent = link.closest('div, li, article, section');
            const snippet = parent?.textContent?.trim().slice(0, 200) || '';

            items.push({ text, href, snippet });
        }
        return items;
    }, limit);
}

async function dismissConsentDialogs(page: Page): Promise<void> {
    try {
        const consentButton = page.locator(
            'button:has-text("Tout refuser"), button:has-text("Reject all"), ' +
            'button:has-text("Alle ablehnen"), button:has-text("Accept"), ' +
            'button:has-text("I agree"), button:has-text("Accepter")'
        ).first();
        if (await consentButton.isVisible({ timeout: 1500 })) {
            await consentButton.click();
            await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { });
        }
    } catch {
        // No consent dialog
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

export function registerTools(server: McpServer) {
    server.registerTool('navigation_search', {
        description: 'Search the web and return top results (titles, links, snippets). Defaults to Google. Supports bing, duckduckgo, and google engines.',
        inputSchema: {
            query: z.string(),
            limit: z.number().optional(),
            engine: z.enum(['bing', 'duckduckgo', 'google']).optional(),
            newTab: z.boolean().optional(),
        },
    }, async (args) => {
        const engineName: SearchEngine = args.engine ?? 'google';
        const engine = engines[engineName];
        const limit = args.limit ?? 10;

        const doSearch = async () => {
            const target = args.newTab ? await ensureContext().then(async ctx => {
                const page = await ctx.newPage();
                const tabId = registerPage(page);
                return { page, tabId };
            }) : await ensurePage();

            const page = target.page;
            const url = engine.buildUrl(args.query);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

            await dismissConsentDialogs(page);

            await randomDelay(300, 600);

            let results = await engine.extract(page, limit);

            if (results.length === 0) {
                results = await extractFallbackResults(page, limit);
            }

            const currentUrl = page.url();
            const pageTitle = await page.title();

            if (results.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            tabId: target.tabId,
                            engine: engineName,
                            url: currentUrl,
                            pageTitle,
                            resultCount: 0,
                            results: [],
                            note: 'No results extracted. The page may have shown a CAPTCHA, consent wall, or unexpected layout. Check pageTitle and url for clues.',
                        }, null, 2),
                    }],
                };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        tabId: target.tabId,
                        engine: engineName,
                        url: currentUrl,
                        resultCount: results.length,
                        results,
                    }, null, 2),
                }],
            };
        };

        try {
            return await withTimeout(doSearch(), 45000, 'navigation_search');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        engine: engineName,
                        error: `Search failed: ${msg}`,
                    }, null, 2),
                }],
                isError: true,
            };
        }
    });
}
