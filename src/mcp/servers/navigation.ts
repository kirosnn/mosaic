import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';

type BrowserTypeName = 'chromium' | 'firefox' | 'webkit';

const browserTypes = { chromium, firefox, webkit };

type LaunchConfig = {
  browserType: BrowserTypeName;
  headless: boolean;
  channel?: string;
  executablePath?: string;
  args: string[];
};

type ContextConfig = {
  userAgent?: string;
  viewport?: { width: number; height: number } | null;
  extraHTTPHeaders?: Record<string, string>;
  locale?: string;
  timezoneId?: string;
};

let browser: Browser | null = null;
let context: BrowserContext | null = null;

let launchConfig: LaunchConfig = {
  browserType: 'chromium',
  headless: true,
  args: [],
};

let contextConfig: ContextConfig = {};

const tabs = new Map<string, Page>();
const tabOrder: string[] = [];
const pageToId = new WeakMap<Page, string>();
let currentTabId: string | null = null;
let tabSeq = 0;

function toLocator(selector: string, selectorType?: 'css' | 'xpath'): string {
  if (selectorType === 'xpath') {
    return `xpath=${selector}`;
  }
  return selector;
}

function normalizeBrowserType(value?: string): BrowserTypeName {
  if (!value) return 'chromium';
  if (value === 'firefox' || value === 'webkit' || value === 'chromium') return value;
  return 'chromium';
}

function registerPage(page: Page): string {
  const existing = pageToId.get(page);
  if (existing) return existing;
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

async function ensureBrowser(): Promise<Browser> {
  if (browser) return browser;
  const launcher = browserTypes[launchConfig.browserType];
  browser = await launcher.launch({
    headless: launchConfig.headless,
    channel: launchConfig.channel,
    executablePath: launchConfig.executablePath,
    args: launchConfig.args.length > 0 ? launchConfig.args : undefined,
  });
  return browser;
}

async function resetContext(): Promise<void> {
  if (context) {
    try { await context.close(); } catch {}
  }
  context = null;
  tabs.clear();
  tabOrder.splice(0, tabOrder.length);
  currentTabId = null;
}

async function ensureContext(): Promise<BrowserContext> {
  if (context) return context;
  const b = await ensureBrowser();
  context = await b.newContext({
    userAgent: contextConfig.userAgent,
    viewport: contextConfig.viewport === null ? null : contextConfig.viewport,
    extraHTTPHeaders: contextConfig.extraHTTPHeaders,
    locale: contextConfig.locale,
    timezoneId: contextConfig.timezoneId,
  });
  context.on('page', page => {
    registerPage(page);
  });
  return context;
}

async function ensurePage(tabId?: string): Promise<{ page: Page; tabId: string }> {
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

async function setLaunchConfig(next: Partial<LaunchConfig>): Promise<void> {
  const updated: LaunchConfig = {
    ...launchConfig,
    ...next,
    browserType: normalizeBrowserType(next.browserType ?? launchConfig.browserType),
    args: next.args ?? launchConfig.args,
  };
  const changed = JSON.stringify(updated) !== JSON.stringify(launchConfig);
  launchConfig = updated;
  if (changed && browser) {
    await closeBrowser();
  }
}

async function setContextConfig(next: Partial<ContextConfig>): Promise<void> {
  const updated: ContextConfig = { ...contextConfig, ...next };
  const changed = JSON.stringify(updated) !== JSON.stringify(contextConfig);
  contextConfig = updated;
  if (changed && context) {
    await resetContext();
  }
}

async function closeBrowser(): Promise<void> {
  if (context) {
    try { await context.close(); } catch { }
  }
  context = null;
  if (browser) {
    try { await browser.close(); } catch { }
  }
  browser = null;
  tabs.clear();
  tabOrder.splice(0, tabOrder.length);
  currentTabId = null;
}

const server = new McpServer({ name: 'navigation', version: '1.0.0' });

server.registerTool('navigation_launch', {
  description: 'Launch or reconfigure the browser instance',
  inputSchema: {
    browserType: z.string().optional(),
    headless: z.boolean().optional(),
    channel: z.string().optional(),
    executablePath: z.string().optional(),
    args: z.array(z.string()).optional(),
  },
}, async (args) => {
  await setLaunchConfig({
    browserType: args.browserType as BrowserTypeName | undefined,
    headless: args.headless ?? launchConfig.headless,
    channel: args.channel,
    executablePath: args.executablePath,
    args: args.args ?? launchConfig.args,
  });
  await ensureBrowser();
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'ready', launchConfig }, null, 2) }],
  };
});

server.registerTool('navigation_close', {
  description: 'Close the browser instance and all tabs',
  inputSchema: {},
}, async () => {
  await closeBrowser();
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'closed' }, null, 2) }] };
});

server.registerTool('navigation_context', {
  description: 'Configure browser context settings (user-agent, viewport, headers, cookies)',
  inputSchema: {
    userAgent: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).nullable().optional(),
    extraHTTPHeaders: z.record(z.string()).optional(),
    locale: z.string().optional(),
    timezoneId: z.string().optional(),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      url: z.string().optional(),
      domain: z.string().optional(),
      path: z.string().optional(),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.string().optional(),
    })).optional(),
  },
}, async (args) => {
  await setContextConfig({
    userAgent: args.userAgent,
    viewport: args.viewport === undefined ? contextConfig.viewport : args.viewport,
    extraHTTPHeaders: args.extraHTTPHeaders,
    locale: args.locale,
    timezoneId: args.timezoneId,
  });
  const ctx = await ensureContext();
  if (args.extraHTTPHeaders) {
    await ctx.setExtraHTTPHeaders(args.extraHTTPHeaders);
  }
  if (args.cookies && args.cookies.length > 0) {
    await ctx.addCookies(args.cookies);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'ready', contextConfig }, null, 2) }],
  };
});

server.registerTool('navigation_new_tab', {
  description: 'Open a new tab, optionally navigating to a URL',
  inputSchema: {
    url: z.string().optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  },
}, async (args) => {
  const ctx = await ensureContext();
  const page = await ctx.newPage();
  const tabId = registerPage(page);
  if (args.url) {
    await page.goto(args.url, { waitUntil: args.waitUntil ?? 'load' });
  }
  const title = await page.title();
  const url = page.url();
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, title, url }, null, 2) }],
  };
});

server.registerTool('navigation_open', {
  description: 'Open a URL in the current tab or a new tab',
  inputSchema: {
    url: z.string(),
    newTab: z.boolean().optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  },
}, async (args) => {
  const target = args.newTab ? await ensureContext().then(async ctx => {
    const page = await ctx.newPage();
    const tabId = registerPage(page);
    return { page, tabId };
  }) : await ensurePage();
  await target.page.goto(args.url, { waitUntil: args.waitUntil ?? 'load' });
  const title = await target.page.title();
  const url = target.page.url();
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId: target.tabId, title, url }, null, 2) }],
  };
});

server.registerTool('navigation_search', {
  description: 'Search the web using a search engine and return top results',
  inputSchema: {
    query: z.string(),
    engine: z.string().optional(),
    limit: z.number().optional(),
    newTab: z.boolean().optional(),
  },
}, async (args) => {
  const engine = args.engine ?? 'https://duckduckgo.com/?q=';
  const url = `${engine}${encodeURIComponent(args.query)}`;
  const target = args.newTab ? await ensureContext().then(async ctx => {
    const page = await ctx.newPage();
    const tabId = registerPage(page);
    return { page, tabId };
  }) : await ensurePage();
  await target.page.goto(url, { waitUntil: 'domcontentloaded' });
  const limit = args.limit ?? 8;
  const results = await target.page.evaluate((max) => {
    const items = Array.from(document.querySelectorAll('a'))
      .map(a => {
        const text = (a.textContent || '').trim();
        const href = a.getAttribute('href') || '';
        return { text, href };
      })
      .filter(r => r.text && r.href && !r.href.startsWith('#'));
    const unique: { text: string; href: string }[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      unique.push(item);
      if (unique.length >= max) break;
    }
    return unique;
  }, limit);
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId: target.tabId, url, results }, null, 2) }],
  };
});

server.registerTool('navigation_back', {
  description: 'Navigate back in the current tab history',
  inputSchema: { tabId: z.string().optional() },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.goBack();
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, url: page.url() }, null, 2) }],
  };
});

server.registerTool('navigation_forward', {
  description: 'Navigate forward in the current tab history',
  inputSchema: { tabId: z.string().optional() },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.goForward();
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, url: page.url() }, null, 2) }],
  };
});

server.registerTool('navigation_reload', {
  description: 'Reload the current tab',
  inputSchema: {
    tabId: z.string().optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.reload({ waitUntil: args.waitUntil ?? 'load' });
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, url: page.url() }, null, 2) }],
  };
});

server.registerTool('navigation_tabs', {
  description: 'List open tabs and current tab',
  inputSchema: {},
}, async () => {
  const list = await Promise.all(tabOrder.map(async id => {
    const page = tabs.get(id);
    return { tabId: id, url: page?.url() ?? '', title: page ? await page.title() : '' };
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify({ currentTabId, tabs: list }, null, 2) }],
  };
});

server.registerTool('navigation_tab_switch', {
  description: 'Switch active tab',
  inputSchema: { tabId: z.string() },
}, async (args) => {
  const page = tabs.get(args.tabId);
  if (!page) throw new Error(`Tab not found: ${args.tabId}`);
  currentTabId = args.tabId;
  return {
    content: [{ type: 'text', text: JSON.stringify({ currentTabId }, null, 2) }],
  };
});

server.registerTool('navigation_tab_close', {
  description: 'Close a tab',
  inputSchema: { tabId: z.string().optional() },
}, async (args) => {
  const id = args.tabId ?? currentTabId;
  if (!id) throw new Error('No active tab');
  const page = tabs.get(id);
  if (!page) throw new Error(`Tab not found: ${id}`);
  await page.close();
  return {
    content: [{ type: 'text', text: JSON.stringify({ closed: id, currentTabId }, null, 2) }],
  };
});

server.registerTool('navigation_wait', {
  description: 'Wait for network idle, selector, URL, or a timeout',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string().optional(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
    url: z.string().optional(),
    timeoutMs: z.number().optional(),
    waitForNetworkIdle: z.boolean().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  if (args.selector) {
    await page.waitForSelector(toLocator(args.selector, args.selectorType), {
      state: args.state ?? 'visible',
      timeout: args.timeoutMs,
    });
  }
  if (args.url) {
    await page.waitForURL(args.url, { timeout: args.timeoutMs });
  }
  if (args.waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: args.timeoutMs });
  }
  if (args.timeoutMs && !args.selector && !args.url && !args.waitForNetworkIdle) {
    await page.waitForTimeout(args.timeoutMs);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, url: page.url() }, null, 2) }],
  };
});

server.registerTool('navigation_click', {
  description: 'Click an element',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    clickCount: z.number().optional(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.click(toLocator(args.selector, args.selectorType), {
    button: args.button,
    clickCount: args.clickCount,
    modifiers: args.modifiers,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }],
  };
});

server.registerTool('navigation_hover', {
  description: 'Hover an element',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.hover(toLocator(args.selector, args.selectorType));
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_fill', {
  description: 'Fill an input, textarea, or contenteditable element',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    value: z.string(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.fill(toLocator(args.selector, args.selectorType), args.value);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_type', {
  description: 'Type into an element',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    text: z.string(),
    delayMs: z.number().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.type(toLocator(args.selector, args.selectorType), args.text, { delay: args.delayMs });
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_select', {
  description: 'Select option(s) in a select element',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    values: z.array(z.string()),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.selectOption(toLocator(args.selector, args.selectorType), args.values);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_submit', {
  description: 'Submit a form',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string().optional(),
    selectorType: z.enum(['css', 'xpath']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const selector = toLocator(args.selector ?? 'form', args.selectorType);
  await page.locator(selector).first().evaluate(form => {
    const el = form as HTMLFormElement;
    if (el.requestSubmit) {
      el.requestSubmit();
    } else {
      el.submit();
    }
  });
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_press', {
  description: 'Press a keyboard shortcut',
  inputSchema: {
    tabId: z.string().optional(),
    key: z.string(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  await page.keyboard.press(args.key);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_scroll', {
  description: 'Scroll the page or an element',
  inputSchema: {
    tabId: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    selector: z.string().optional(),
    selectorType: z.enum(['css', 'xpath']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const x = args.x ?? 0;
  const y = args.y ?? 0;
  if (args.selector) {
    const loc = toLocator(args.selector, args.selectorType);
    const locator = page.locator(loc).first();
    await locator.evaluate((el, delta) => {
      (el as HTMLElement).scrollBy(delta.x, delta.y);
    }, { x, y });
  } else {
    await page.mouse.wheel(x, y);
  }
  return { content: [{ type: 'text', text: JSON.stringify({ tabId }, null, 2) }] };
});

server.registerTool('navigation_text', {
  description: 'Read visible text from the page or a selector',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string().optional(),
    selectorType: z.enum(['css', 'xpath']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  let text = '';
  if (args.selector) {
    text = await page.innerText(toLocator(args.selector, args.selectorType));
  } else {
    text = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      let node = walker.nextNode();
      while (node) {
        const value = node.nodeValue?.trim();
        if (value) parts.push(value);
        node = walker.nextNode();
      }
      return parts.join('\n');
    });
  }
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, text }, null, 2) }] };
});

server.registerTool('navigation_query', {
  description: 'Extract elements via CSS or XPath selectors',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    attributes: z.array(z.string()).optional(),
    limit: z.number().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const selector = toLocator(args.selector, args.selectorType);
  const limit = args.limit ?? 50;
  const attributes = args.attributes ?? [];
  const items = await page.$$eval(selector, (els, attrs, max) => {
    return Array.from(els).slice(0, max).map(el => {
      const record: Record<string, string> = {};
      for (const attr of attrs as string[]) {
        const val = (el as Element).getAttribute(attr);
        if (val !== null) record[attr] = val;
      }
      return {
        text: (el.textContent || '').trim(),
        attributes: record,
      };
    });
  }, attributes, limit);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, items }, null, 2) }] };
});

server.registerTool('navigation_extract', {
  description: 'Extract structured data from lists, tables, or cards',
  inputSchema: {
    tabId: z.string().optional(),
    itemSelector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    fields: z.record(z.union([
      z.string(),
      z.object({ selector: z.string(), attr: z.string().optional(), text: z.boolean().optional() }),
    ])),
    limit: z.number().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const selector = toLocator(args.itemSelector, args.selectorType);
  const limit = args.limit ?? 50;
  const fields = args.fields;
  const items = await page.$$eval(selector, (els, fieldsDef, max) => {
    const list = Array.from(els).slice(0, max);
    return list.map(el => {
      const record: Record<string, string> = {};
      for (const key of Object.keys(fieldsDef as Record<string, any>)) {
        const def = (fieldsDef as any)[key];
        if (typeof def === 'string') {
          const target = (el as Element).querySelector(def);
          record[key] = (target?.textContent || '').trim();
        } else if (def && typeof def === 'object') {
          const target = (el as Element).querySelector(def.selector);
          if (!target) {
            record[key] = '';
          } else if (def.attr) {
            record[key] = target.getAttribute(def.attr) || '';
          } else if (def.text === false) {
            record[key] = target.innerHTML || '';
          } else {
            record[key] = (target.textContent || '').trim();
          }
        }
      }
      return record;
    });
  }, fields, limit);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, items }, null, 2) }] };
});

server.registerTool('navigation_attributes', {
  description: 'Get attributes for an element or list of elements',
  inputSchema: {
    tabId: z.string().optional(),
    selector: z.string(),
    selectorType: z.enum(['css', 'xpath']).optional(),
    attributes: z.array(z.string()),
    limit: z.number().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const selector = toLocator(args.selector, args.selectorType);
  const limit = args.limit ?? 50;
  const items = await page.$$eval(selector, (els, attrs, max) => {
    return Array.from(els).slice(0, max).map(el => {
      const record: Record<string, string> = {};
      for (const attr of attrs as string[]) {
        const val = (el as Element).getAttribute(attr);
        if (val !== null) record[attr] = val;
      }
      return record;
    });
  }, args.attributes, limit);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, items }, null, 2) }] };
});

server.registerTool('navigation_dom', {
  description: 'Read raw or cleaned DOM HTML',
  inputSchema: {
    tabId: z.string().optional(),
    mode: z.enum(['raw', 'clean']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  let html = '';
  if (args.mode === 'clean') {
    html = await page.evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      return clone.outerHTML;
    });
  } else {
    html = await page.content();
  }
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, html }, null, 2) }] };
});

server.registerTool('navigation_ui_state', {
  description: 'Detect UI states, errors, warnings, or success messages',
  inputSchema: {
    tabId: z.string().optional(),
    selectors: z.record(z.string()).optional(),
    patterns: z.array(z.string()).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const selectors = args.selectors ?? {};
  const stateEntries: Record<string, string[]> = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const items = await page.$$eval(selector, els => els.map(el => (el.textContent || '').trim()).filter(Boolean));
    stateEntries[key] = items;
  }
  const text = await page.evaluate(() => document.body?.innerText || '');
  const patterns = args.patterns ?? [];
  const matches = patterns.map(p => {
    const re = new RegExp(p, 'i');
    return { pattern: p, matched: re.test(text) };
  });
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, selectors: stateEntries, matches }, null, 2) }] };
});

server.registerTool('navigation_cookies', {
  description: 'Get, set, or clear cookies',
  inputSchema: {
    action: z.enum(['get', 'set', 'clear']),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      url: z.string().optional(),
      domain: z.string().optional(),
      path: z.string().optional(),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.string().optional(),
    })).optional(),
  },
}, async (args) => {
  const ctx = await ensureContext();
  if (args.action === 'set') {
    if (args.cookies && args.cookies.length > 0) {
      await ctx.addCookies(args.cookies);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }, null, 2) }] };
  }
  if (args.action === 'clear') {
    await ctx.clearCookies();
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'cleared' }, null, 2) }] };
  }
  const cookies = await ctx.cookies();
  return { content: [{ type: 'text', text: JSON.stringify({ cookies }, null, 2) }] };
});

server.registerTool('navigation_headers', {
  description: 'Set extra HTTP headers for the browser context',
  inputSchema: {
    headers: z.record(z.string()),
  },
}, async (args) => {
  await setContextConfig({ extraHTTPHeaders: args.headers });
  const ctx = await ensureContext();
  await ctx.setExtraHTTPHeaders(args.headers);
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }, null, 2) }] };
});

server.registerTool('navigation_dialog', {
  description: 'Handle JavaScript dialogs (alert, confirm, prompt)',
  inputSchema: {
    tabId: z.string().optional(),
    action: z.enum(['accept', 'dismiss']),
    promptText: z.string().optional(),
    timeoutMs: z.number().optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const dialog = await page.waitForEvent('dialog', { timeout: args.timeoutMs ?? 5000 });
  const message = dialog.message();
  if (args.action === 'accept') {
    await dialog.accept(args.promptText);
  } else {
    await dialog.dismiss();
  }
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, message }, null, 2) }] };
});

server.registerTool('navigation_wait_popup', {
  description: 'Wait for a popup window and register it as a new tab',
  inputSchema: {
    tabId: z.string().optional(),
    timeoutMs: z.number().optional(),
  },
}, async (args) => {
  const { page } = await ensurePage(args.tabId);
  const popup = await page.waitForEvent('popup', { timeout: args.timeoutMs ?? 10000 });
  const tabId = registerPage(popup);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, url: popup.url() }, null, 2) }] };
});

server.registerTool('navigation_cookie_consent', {
  description: 'Attempt to accept or reject common cookie consent banners',
  inputSchema: {
    tabId: z.string().optional(),
    action: z.enum(['accept', 'reject']).optional(),
  },
}, async (args) => {
  const { page, tabId } = await ensurePage(args.tabId);
  const action = args.action ?? 'accept';
  const labels = action === 'accept'
    ? ['accept', 'agree', 'allow', 'ok', 'continue', 'tout accepter', 'accepter', 'autoriser']
    : ['reject', 'refuse', 'decline', 'deny', 'tout refuser', 'refuser'];
  const result = await page.evaluate((labels) => {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
    for (const btn of buttons) {
      const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase();
      if (!text) continue;
      if (labels.some(label => text.includes(label))) {
        (btn as HTMLElement).click();
        return { clicked: true, text };
      }
    }
    return { clicked: false, text: '' };
  }, labels);
  return { content: [{ type: 'text', text: JSON.stringify({ tabId, result }, null, 2) }] };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
