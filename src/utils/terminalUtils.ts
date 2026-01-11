export function setTerminalTitle(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
}

export function clearTerminal(): void {
    if (!process.stdout.isTTY) {
        return;
    }

    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

export function extractTitleFromResponse(content: string): string | null {
    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim();
    }
    return null;
}

export function removeTitleFromContent(content: string): string {
    let cleaned = content.replace(/<title>[^<]*<\/title>\s*/gi, '');
    cleaned = cleaned.trimStart();
    return cleaned;
}