/**
 * adapters/claude.js — Claude.ai Content Adapter
 */
export default class ClaudeAdapter {
    constructor() { this.name = "Claude"; }

    extract() {
        // Title: try truncated title element, fall back to document.title
        let title = document.title || "Untitled";
        const titleEl = document.querySelector('div[class*="truncate"]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // Primary: .font-claude-message elements
        const msgElements = document.querySelectorAll('.font-claude-message');

        if (msgElements.length) {
            const messages = [];
            const lines    = [];

            // Claude renders messages in alternating order: user, assistant, user, assistant...
            // A more reliable approach is to inspect the parent container for a role indicator.
            // For now we check for a parent with data-testid or known class names.
            msgElements.forEach((el) => {
                const text = el.innerText?.trim();
                if (!text) return;

                // Try to detect role from DOM ancestry
                const isHuman =
                    el.closest('[data-testid*="human"]') ||
                    el.closest('[class*="human"]') ||
                    el.closest('[class*="user"]');

                const role = isHuman ? "user" : "assistant";
                messages.push({ role, text });
                lines.push(`[${role.toUpperCase()}]:\n${text}`);
            });

            if (!lines.length) throw new Error("Claude: message elements found but all were empty.");

            return {
                title,
                content: lines.join('\n\n---\n\n'),
                platform: "claude",
                messages
            };
        }

        // Fallback: grid container
        const grid = document.querySelector('.grid-cols-1');
        if (grid) {
            const text = grid.innerText?.trim();
            if (!text) throw new Error("Claude: fallback container is empty.");
            return { title, content: text, platform: "claude", messages: [] };
        }

        throw new Error("Claude: could not find conversation elements. Is this a conversation page?");
    }
}
