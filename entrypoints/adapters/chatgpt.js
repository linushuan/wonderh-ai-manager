/**
 * adapters/chatgpt.js — ChatGPT Content Adapter
 */
export default class ChatGPTAdapter {
    constructor() { this.name = "ChatGPT"; }

    extract() {
        const main = document.querySelector('main');
        if (!main) throw new Error("ChatGPT: could not find <main> element. Is this a conversation page?");

        // Title: try sidebar active item first, fall back to document.title
        let title = document.title || "Untitled";
        const titleEl = document.querySelector('div[class*="sidebar"] a[class*="bg-token"]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // Messages: prefer role-attributed nodes
        const msgNodes = main.querySelectorAll('[data-message-author-role]');

        if (!msgNodes.length) {
            // Fallback: raw text of <main>
            const rawText = main.innerText?.trim();
            if (!rawText) throw new Error("ChatGPT: page is empty or still loading.");
            return { title, content: rawText, platform: "chatgpt", messages: [] };
        }

        const messages = [];
        const lines    = [];
        msgNodes.forEach(node => {
            const role = node.getAttribute('data-message-author-role') || 'unknown';
            const text = node.innerText?.trim() || '';
            if (!text) return; // skip empty nodes
            messages.push({ role, text });
            lines.push(`[${role.toUpperCase()}]:\n${text}`);
        });

        return {
            title,
            content: lines.join('\n\n---\n\n'),
            platform: "chatgpt",
            messages
        };
    }
}
