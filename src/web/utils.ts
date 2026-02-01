export {
    formatToolMessage,
    parseToolHeader,
    formatToolResult,
    isToolSuccess,
    formatErrorMessage,
    DEFAULT_MAX_TOOL_LINES,
} from '../utils/toolFormatting';

export { parseDiffLine, getDiffLineColors, type ParsedDiffLine } from '../utils/diff';

export const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function extractTitle(content: string, alreadyResolved: boolean): {
    title: string | null;
    cleanContent: string;
    isPending: boolean;
    noTitle: boolean
} {
    const trimmed = content.trimStart();

    const titleMatch = trimmed.match(/^<title>(.*?)<\/title>\s*/si);
    if (titleMatch) {
        const title = alreadyResolved ? null : (titleMatch[1]?.trim() || null);
        const cleanContent = trimmed.replace(/^<title>.*?<\/title>\s*/si, '');
        return { title, cleanContent, isPending: false, noTitle: false };
    }

    if (alreadyResolved) {
        return { title: null, cleanContent: content, isPending: false, noTitle: false };
    }

    const partialTitlePattern = /^<(t(i(t(l(e(>.*)?)?)?)?)?)?$/i;
    if (partialTitlePattern.test(trimmed) || (trimmed.toLowerCase().startsWith('<title>') && !trimmed.toLowerCase().includes('</title>'))) {
        return { title: null, cleanContent: '', isPending: true, noTitle: false };
    }

    return { title: null, cleanContent: content, isPending: false, noTitle: true };
}

export function setDocumentTitle(title: string) {
    document.title = `${title} - Mosaic`;
}

export const BLEND_WORDS = [
    "Blended",
    "Crafted",
    "Brewed",
    "Cooked",
    "Forged",
    "Woven",
    "Composed",
    "Rendered",
    "Conjured",
    "Distilled",
    "Worked"
];

export function getRandomBlendWord(): string {
    return BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)]!;
}