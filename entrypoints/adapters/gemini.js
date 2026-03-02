/**
 * adapters/gemini.js — Google Gemini Content Adapter
 *
 * DOM Strategy (2024+):
 *   1. Search the ENTIRE document for <user-query> and <model-response> custom elements
 *      (these are the structured conversation turns in Gemini's Web Component architecture).
 *   2. For text, prefer inner content children (.model-response-text, .markdown-main-panel)
 *      to avoid capturing toolbar/action button text.
 *   3. Fallback: filter raw innerText of a conversation container.
 */

const NOISE_LINES = new Set([
    'Show drafts', 'Regenerate', 'Modify response', 'Listen',
    'Share', 'More', 'thumb_up', 'thumb_down', 'content_copy',
    'Google', 'Report a legal issue', 'volume_up', 'Edit in Docs',
    'flag', 'Share & export', 'Edit query', 'close',
]);

export default class GeminiAdapter {
    constructor() { this.name = "Gemini"; }

    /**
     * Strip known prefixes from user query text (e.g. "你說了" added by Gemini UI).
     */
    _cleanUserText(text) {
        return text.replace(/^你說了\s*/, '');
    }

    extract() {
        // Title
        let title = document.title || "Untitled";
        const titleEl =
            document.querySelector('h1[class*="conversation-title"]') ||
            document.querySelector('.conversation-title') ||
            document.querySelector('[data-conversation-title]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // ── Step 1: Search the ENTIRE document for structured message elements ──
        // Do NOT restrict to a specific container — Gemini's DOM nesting varies.
        const messageNodes = document.querySelectorAll('user-query, model-response');

        if (messageNodes.length > 0) {
            const messages = [];
            const fullContent = [];

            for (const node of messageNodes) {
                const tagName = node.tagName.toLowerCase();
                const role = tagName === 'user-query' ? 'user' : 'assistant';

                // Prefer inner content elements to skip toolbar/action buttons
                const innerContent =
                    node.querySelector('.model-response-text') ||
                    node.querySelector('.markdown-main-panel') ||
                    node.querySelector('.query-text') ||
                    node.querySelector('.query-content') ||
                    node;

                const rawText = innerContent?.innerText?.trim() || '';
                if (!rawText) continue;

                // Filter out noise lines that leaked into the text
                let cleanedText = rawText
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 0)
                    .filter(l => !NOISE_LINES.has(l))
                    .join('\n');

                // Strip "你說了" prefix from user messages
                if (role === 'user') {
                    cleanedText = this._cleanUserText(cleanedText);
                }

                if (cleanedText) {
                    messages.push({ role, text: cleanedText });
                    fullContent.push(cleanedText);
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

        // ── Step 2: Fallback — find a conversation container and filter raw text ──
        const container =
            document.querySelector('infinite-scroller') ||
            document.querySelector('.conversation-container') ||
            document.querySelector('[role="main"] .conversation-container');

        if (container) {
            const rawText = container.innerText || '';
            const cleanText = rawText
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0)
                .filter(l => !NOISE_LINES.has(l))
                .join('\n');

            if (cleanText && cleanText.length > 50) {
                return {
                    title,
                    content: cleanText,
                    platform: "gemini",
                    messages: []
                };
            }
        }

        // ── Step 3: Last resort — body text but exclude sidebar ──
        // Try to get just the main content area, not the sidebar
        const main = document.querySelector('[role="main"]');
        const textSource = main || document.body;
        const bodyText = textSource?.innerText?.trim() || '';

        if (bodyText.length < 100) {
            throw new Error("Gemini: page content too short. The page may still be loading.");
        }

        return { title, content: bodyText, platform: "gemini", messages: [] };
    }

    /**
     * Send a message to Gemini by injecting text into the input field and pressing Enter.
     * Uses keyboard events instead of button clicks for better framework compatibility.
     * @param {string} text - The message to send
     */
    sendMessage(text) {
        if (!text?.trim()) throw new Error("Cannot send empty message.");

        // Gemini uses a rich-text editor — try multiple selectors
        const inputEl =
            document.querySelector('rich-textarea .ql-editor') ||
            document.querySelector('.ql-editor[contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][aria-label]') ||
            document.querySelector('textarea[aria-label]');

        if (!inputEl) throw new Error("Gemini: could not find input field. The page may have changed.");

        // Focus the input first
        inputEl.focus();

        // Set text content
        if (inputEl.tagName === 'TEXTAREA') {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            // contenteditable div — set text and dispatch events
            inputEl.innerHTML = `<p>${text}</p>`;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Use Enter key to submit — this triggers Gemini's internal event handlers
        // more reliably than clicking the send button
        setTimeout(() => {
            const enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            });
            inputEl.dispatchEvent(enterEvent);

            // Also try clicking the send button as a fallback
            const sendBtn =
                document.querySelector('.send-button') ||
                document.querySelector('button[aria-label="Send message"]') ||
                document.querySelector('button.send-button') ||
                document.querySelector('[data-test-id="send-button"]');
            if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
            }
        }, 200);
    }

    /**
     * Prepare the page for content extraction by scrolling to the bottom.
     * This forces Gemini's virtual scroller to render the latest messages.
     */
    prepareForExtract() {
        // Scroll the conversation to the very bottom
        const scroller =
            document.querySelector('infinite-scroller') ||
            document.querySelector('.conversation-container') ||
            document.querySelector('[role="main"]');

        if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }
        // Also scroll window itself
        window.scrollTo(0, document.body.scrollHeight);
    }
}
