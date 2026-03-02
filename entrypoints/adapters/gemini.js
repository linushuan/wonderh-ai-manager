/**
 * adapters/gemini.js — Google Gemini Content Adapter
 *
 * DOM Strategy (2024+):
 *   Primary: Look for <user-query> and <model-response> custom elements
 *   inside 'infinite-scroller' or '.conversation-container' or main content area.
 *   For text extraction, use .model-response-text / .query-text children
 *   to avoid capturing toolbar buttons/actions text.
 *   Fallback: filter raw innerText of the conversation container.
 */

const NOISE_LINES = new Set([
    'Show drafts', 'Regenerate', 'Modify response', 'Listen',
    'Share', 'More', 'thumb_up', 'thumb_down', 'content_copy',
    'Google', 'Report a legal issue', 'volume_up', 'Edit in Docs',
    'flag', 'Share & export', 'Edit query',
]);

export default class GeminiAdapter {
    constructor() { this.name = "Gemini"; }

    extract() {
        // Title
        let title = document.title || "Untitled";
        const titleEl =
            document.querySelector('h1[class*="conversation-title"]') ||
            document.querySelector('.conversation-title') ||
            document.querySelector('[data-conversation-title]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // Find conversation container — try multiple selectors
        const container =
            document.querySelector('infinite-scroller') ||
            document.querySelector('.conversation-container') ||
            document.querySelector('[role="main"] .conversation-container') ||
            document.querySelector('[role="main"]');

        if (!container) {
            const bodyText = document.body?.innerText?.trim() || '';
            if (bodyText.length < 100) {
                throw new Error("Gemini: page content too short. The page may still be loading.");
            }
            return { title, content: bodyText, platform: "gemini", messages: [] };
        }

        // Try to extract structured messages
        const messageNodes = container.querySelectorAll('user-query, model-response');
        let messages = [];
        let fullContent = [];

        if (messageNodes.length > 0) {
            for (const node of messageNodes) {
                const tagName = node.tagName.toLowerCase();
                const role = tagName === 'user-query' ? 'user' : 'assistant';

                // Try to get text from inner content elements first, avoiding toolbar text
                const innerContent =
                    node.querySelector('.model-response-text') ||
                    node.querySelector('.markdown-main-panel') ||
                    node.querySelector('.query-text') ||
                    node.querySelector('.query-content') ||
                    node;

                const text = innerContent?.innerText?.trim() || '';

                if (text) {
                    // Filter out noise lines that may have leaked in
                    const cleanedLines = text.split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0)
                        .filter(l => !NOISE_LINES.has(l));
                    const cleanedText = cleanedLines.join('\n');

                    if (cleanedText) {
                        messages.push({ role, text: cleanedText });
                        fullContent.push(cleanedText);
                    }
                }
            }

            if (fullContent.length > 0) {
                return {
                    title,
                    content: fullContent.join('\n\n'),
                    platform: "gemini",
                    messages
                };
            }
        }

        // Fallback: raw text filtering
        const rawText = container.innerText || '';
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
