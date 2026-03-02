/**
 * adapters/gemini.js — Google Gemini Content Adapter
 */

const NOISE_LINES = new Set(['Show drafts', 'Regenerate', 'Modify response', 'Listen', 'Share', 'More']);

export default class GeminiAdapter {
    constructor() { this.name = "Gemini"; }

    extract() {
        // Title
        let title = document.title || "Untitled";
        const titleEl = document.querySelector('h1[class*="conversation-title"]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // Content
        const scroller = document.querySelector('infinite-scroller');

        if (!scroller) {
            // Fallback to body text
            const bodyText = document.body?.innerText?.trim() || '';
            if (bodyText.length < 100) {
                throw new Error("Gemini: page content too short. The page may still be loading.");
            }
            return { title, content: bodyText, platform: "gemini", messages: [] };
        }

        const rawText   = scroller.innerText || '';
        const cleanText = rawText
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .filter(l => !NOISE_LINES.has(l))
            .join('\n');

        if (!cleanText) {
            throw new Error("Gemini: conversation appears empty after filtering.");
        }

        return {
            title,
            content: cleanText,
            platform: "gemini",
            messages: [] // Gemini doesn't expose clear role separators
        };
    }
}
