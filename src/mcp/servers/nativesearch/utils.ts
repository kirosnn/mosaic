import type { Page } from 'playwright';

export const randomDelay = (min: number, max: number) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

export async function humanType(page: any, selector: string, text: string) {
    const element = page.locator(selector);
    await element.click();
    for (const char of text) {
        await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
    }
}

export async function waitForStability(page: Page, timeout = 10000): Promise<void> {
    try {
        await page.waitForLoadState('networkidle', { timeout });
    } catch {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await randomDelay(300, 600);
    }
}