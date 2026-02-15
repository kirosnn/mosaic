import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { LaunchConfig, ContextConfig } from './types.js';

const browserTypes = { chromium, firefox, webkit };

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export const launchConfig: LaunchConfig = {
    browserType: 'chromium',
    headless: true,
    args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--disable-features=IsolateOrigins,site-per-process',
    ],
};

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_PAGE_TIMEOUT = 30000;
const DEFAULT_NAV_TIMEOUT = 60000;

export const contextConfig: ContextConfig = {
    userAgent: DEFAULT_USER_AGENT,
    viewport: DEFAULT_VIEWPORT,
};

const tabs = new Map<string, Page>();
const tabOrder: string[] = [];
const pageToId = new WeakMap<Page, string>();
let currentTabId: string | null = null;
let tabSeq = 0;

function configurePage(page: Page): void {
    page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT);
}

export function registerPage(page: Page): string {
    const existing = pageToId.get(page);
    if (existing) return existing;
    configurePage(page);
    const id = `tab_${++tabSeq}`;
    pageToId.set(page, id);
    tabs.set(id, page);
    tabOrder.push(id);
    currentTabId = id;
    page.on('close', () => {
        tabs.delete(id);
        const index = tabOrder.indexOf(id);
        if (index >= 0) tabOrder.splice(index, 1);
        if (currentTabId === id) {
            currentTabId = tabOrder.length > 0 ? tabOrder[tabOrder.length - 1]! : null;
        }
    });
    return id;
}

export async function ensureBrowser(): Promise<Browser> {
    if (browser) return browser;
    const launcher = browserTypes[launchConfig.browserType];
    browser = await launcher.launch({
        headless: launchConfig.headless,
        channel: launchConfig.channel,
        executablePath: launchConfig.executablePath,
        args: [
            ...launchConfig.args,
            ...(launchConfig.args.length > 0 ? [] : [])
        ],
    });
    return browser;
}

export async function ensureContext(): Promise<BrowserContext> {
    if (context) return context;
    const b = await ensureBrowser();
    context = await b.newContext({
        userAgent: contextConfig.userAgent,
        viewport: contextConfig.viewport === null ? null : contextConfig.viewport,
        extraHTTPHeaders: contextConfig.extraHTTPHeaders,
        locale: 'en-US',
        timezoneId: contextConfig.timezoneId,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        javaScriptEnabled: true,
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });

        if (!(window as any).chrome) {
            (window as any).chrome = {
                runtime: {},
                loadTimes: function () { },
                csi: function () { },
                app: {},
            };
        }

        if (navigator.plugins.length === 0) {
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    return [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                    ];
                },
            });
        }

        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });

    context.on('page', page => {
        registerPage(page);
    });
    return context;
}

export async function ensurePage(tabId?: string): Promise<{ page: Page; tabId: string }> {
    const ctx = await ensureContext();
    if (tabId) {
        const existing = tabs.get(tabId);
        if (!existing) {
            throw new Error(`Tab not found: ${tabId}`);
        }
        currentTabId = tabId;
        return { page: existing, tabId };
    }
    if (currentTabId) {
        const current = tabs.get(currentTabId);
        if (current) return { page: current, tabId: currentTabId };
    }
    const page = await ctx.newPage();
    const id = registerPage(page);
    return { page, tabId: id };
}

export function getTabs() {
    return tabs;
}