export type BrowserTypeName = 'chromium' | 'firefox' | 'webkit';

export type LaunchConfig = {
    browserType: BrowserTypeName;
    headless: boolean;
    channel?: string;
    executablePath?: string;
    args: string[];
};

export type ContextConfig = {
    userAgent?: string;
    viewport?: { width: number; height: number } | null;
    extraHTTPHeaders?: Record<string, string>;
    locale?: string;
    timezoneId?: string;
};