export {
    formatToolMessage,
    parseToolHeader,
    getExploreToolInfo,
    formatToolResult,
    isToolSuccess,
    formatErrorMessage,
    DEFAULT_MAX_TOOL_LINES,
    normalizeToolCall,
} from '../utils/toolFormatting';

export { parseDiffLine, getDiffLineColors, type ParsedDiffLine } from '../utils/diff';

export const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function extractTitle(content: string, alreadyResolved: boolean): {
    title: string | null;
    cleanContent: string;
    isPending: boolean;
    noTitle: boolean;
    isTitlePseudoCall: boolean
} {
    const trimmed = content.trimStart();

    const titleMatch = trimmed.match(/^<title>(.*?)<\/title>\s*/si);
    if (titleMatch) {
        const title = alreadyResolved ? null : (titleMatch[1]?.trim() || null);
        const cleanContent = trimmed.replace(/^<title>.*?<\/title>\s*/si, '');
        return { title, cleanContent, isPending: false, noTitle: false, isTitlePseudoCall: true };
    }

    const titleCallMatch = trimmed.match(/^title\s*\(\s*(?:title\s*=\s*)?(['\"])([\s\S]*?)\1\s*\)\s*/i);
    if (titleCallMatch) {
        const t = titleCallMatch[2] ?? '';
        const title = alreadyResolved ? null : (t.trim() || null);
        const cleanContent = trimmed.replace(/^title\s*\(\s*(?:title\s*=\s*)?(['\"])([\s\S]*?)\1\s*\)\s*/i, '');
        return { title, cleanContent, isPending: false, noTitle: false, isTitlePseudoCall: true };
    }

    if (alreadyResolved) {
        return { title: null, cleanContent: content, isPending: false, noTitle: false, isTitlePseudoCall: false };
    }

    const partialTitlePattern = /^<(t(i(t(l(e(>.*)?)?)?)?)?)?$/i;
    if (partialTitlePattern.test(trimmed) || (trimmed.toLowerCase().startsWith('<title>') && !trimmed.toLowerCase().includes('</title>'))) {
        return { title: null, cleanContent: '', isPending: true, noTitle: false, isTitlePseudoCall: false };
    }

    if (trimmed.toLowerCase().startsWith('title(') && !trimmed.includes(')')) {
        return { title: null, cleanContent: '', isPending: true, noTitle: false, isTitlePseudoCall: true };
    }

    return { title: null, cleanContent: content, isPending: false, noTitle: true, isTitlePseudoCall: false };
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
