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

        // Try to extract structured messages first
        const messageNodes = scroller.querySelectorAll('user-query, model-response');
        let messages = [];
        let fullContent = [];

        if (messageNodes.length > 0) {
            for (const node of messageNodes) {
                const role = node.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
                const text = node.innerText?.trim() || '';

                if (text) {
                    messages.push({ role, text });
                    fullContent.push(text);
                }
            }

            const cleanText = fullContent.join('\n\n');
            if (!cleanText) {
                throw new Error("Gemini: conversation appears empty after extracting structured messages.");
            }

            return {
                title,
                content: cleanText, // Will be saved to DB by background script
                platform: "gemini",
                messages
            };
        }

        // Fallback to raw text filtering if no structured nodes found
        const rawText = scroller.innerText || '';
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
            messages: []
        };
    }
}
