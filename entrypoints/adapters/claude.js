/**
 * adapters/claude.js — Claude.ai Content Adapter
 *
 * Extracts conversation content from Claude pages, converting rich HTML
 * (code blocks, LaTeX, tables, formatting) back to clean Markdown so
 * it renders correctly in the dashboard via marked + KaTeX.
 *
 * Updated 2026-03 to match current Claude.ai DOM structure:
 *   - Turns wrapped in div[data-test-render-count]
 *   - User messages: div[data-testid="user-message"]
 *   - Assistant responses: div.font-claude-response > div.standard-markdown
 *   - Title: button[data-testid="chat-title-button"] .truncate
 *   - Input: div[data-testid="chat-input"] (ProseMirror)
 *   - Streaming: div[data-is-streaming="true"]
 */

// ─── Selector sets (primary = current Claude.ai, fallbacks = older layouts) ──
const USER_SELECTORS = [
    '[data-testid="user-message"]',           // current (2025-2026)
    '[data-testid^="user-human-turn"]',       // legacy fallback
    '[data-testid*="user-human-turn"]',       // legacy fallback
];

const ASSISTANT_SELECTORS = [
    '.font-claude-response',                  // current (2025-2026)
    '.standard-markdown',                     // content inside response
    '[data-testid^="assistant-turn"]',        // legacy fallback
    '[data-testid*="assistant"]',             // legacy fallback
    '[data-testid^="chat-message-text"]',     // legacy fallback
    '[data-testid*="model-response"]',        // legacy fallback
    '.font-claude-message',                   // legacy fallback
];

const CONVERSATION_ROOT_SELECTORS = [
    '[data-testid*="conversation"]',
    '[data-testid*="chat"]',
    '[role="main"]',
    'main',
    '.grid-cols-1',
];

export default class ClaudeAdapter {
    constructor() { this.name = "Claude"; }

    /**
     * Escape characters in a URL that would break markdown link/image syntax.
     * Specifically, `)` ends a [text](url) link prematurely.
     */
    _safeUrl(url) {
        return String(url).replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
    }

    // ─── DOM-to-Markdown helpers ──────────────────────────────

    /**
     * Convert a Claude DOM element tree to clean markdown text.
     * Walks child elements recursively, converting each to markdown syntax.
     * Handles KaTeX math, code blocks, tables, links, formatting.
     * @param {Element} container
     * @returns {string}
     */
    _domToMarkdown(container) {
        const parts = [];
        this._walkNodes(container, parts, 0);
        return parts.join('')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Recursively walk DOM nodes and convert to markdown.
     */
    _walkNodes(node, parts, listDepth) {
        const children = node.childNodes ? Array.from(node.childNodes) : [];

        for (const child of children) {
            // Text node
            if (child.nodeType === 3) {
                const text = child.textContent || '';
                if (text.trim()) parts.push(text);
                continue;
            }
            if (child.nodeType !== 1) continue;

            const el = child;
            const tag = el.tagName?.toUpperCase() || '';

            // Skip buttons, copy elements, UI chrome
            if (tag === 'BUTTON' || tag === 'NAV' || tag === 'HEADER' ||
                tag === 'SVG' || tag === 'FOOTER' ||
                el.classList?.contains('copy-code-button') ||
                el.classList?.contains('result-streaming') ||
                el.getAttribute?.('aria-hidden') === 'true') continue;

            // ── KaTeX display math (block) ──
            if (el.classList?.contains('katex-display') ||
                (el.classList?.contains('math') && el.classList?.contains('math-display')) ||
                el.classList?.contains('math-block')) {
                const latex = this._extractLatex(el);
                if (latex) { parts.push(`\n\n$$\n${latex}\n$$\n\n`); continue; }
                // Skip element to avoid duplicate textContent from KaTeX dual layers
                if (el.querySelector('.katex') || el.classList?.contains('katex-display')) continue;
            }

            // ── KaTeX inline math ──
            if ((el.classList?.contains('katex') && !el.closest('.katex-display')) ||
                (el.classList?.contains('math') && el.classList?.contains('math-inline')) ||
                (el.classList?.contains('math-inline'))) {
                const latex = this._extractLatex(el);
                if (latex) { parts.push(`$${latex}$`); continue; }
                if (el.querySelector('.katex') || el.classList?.contains('katex')) continue;
            }

            // ── Code block: <pre> ──
            if (tag === 'PRE') {
                const codeEl = el.querySelector('code');
                const code = codeEl?.innerText || codeEl?.textContent || el.innerText || el.textContent || '';
                let lang = '';
                const className = (codeEl?.className || '').toLowerCase();
                const langMatch = className.match(/language-([a-z0-9_+-]+)/);
                if (langMatch) lang = langMatch[1];
                // Try header bar for language label (Claude uses .text-text-500.font-small)
                if (!lang) {
                    const header = el.closest('.relative.group\\/copy')?.querySelector('.text-text-500') ||
                        el.querySelector('[class*="code-header"], [class*="text-token"]');
                    if (header) lang = (header.textContent || '').trim().split('\n')[0].trim().toLowerCase();
                }
                let cleanCode = code;
                // Strip language label that may appear at top
                if (lang) {
                    const lines = cleanCode.split('\n');
                    if ((lines[0] || '').trim().toLowerCase() === lang.toLowerCase()) {
                        lines.shift();
                        cleanCode = lines.join('\n');
                    }
                }
                // Strip common language aliases from first line
                const codeLines = cleanCode.split('\n');
                const firstLine = (codeLines[0] || '').trim().toLowerCase();
                const langAliases = new Set([
                    'bash', 'sh', 'shell', 'zsh', 'javascript', 'js', 'typescript', 'ts',
                    'python', 'py', 'rust', 'go', 'java', 'c', 'cpp', 'c++',
                    'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sql', 'php',
                    'latex', 'tex', 'markdown', 'md', 'ruby', 'swift', 'kotlin',
                    'plaintext', 'text'
                ]);
                if (codeLines.length > 1 && langAliases.has(firstLine)) {
                    codeLines.shift();
                    cleanCode = codeLines.join('\n');
                    if (!lang) lang = firstLine === 'sh' ? 'bash' : firstLine;
                }
                cleanCode = cleanCode.replace(/^(?:Copy code|Copy)\s*/i, '').trim();
                parts.push(`\n\n\`\`\`${lang}\n${cleanCode}\n\`\`\`\n\n`);
                continue;
            }

            // ── Table ──
            if (tag === 'TABLE') {
                const md = this._tableToMarkdown(el);
                if (md) { parts.push(`\n\n${md}\n\n`); continue; }
            }

            // ── Headings ──
            const headingMatch = tag.match?.(/^H([1-6])$/);
            if (headingMatch) {
                const level = parseInt(headingMatch[1]);
                const text = this._inlineToMarkdown(el);
                parts.push(`\n\n${'#'.repeat(level)} ${text}\n\n`);
                continue;
            }

            // ── Paragraph ──
            if (tag === 'P') {
                const text = this._inlineToMarkdown(el);
                if (text.trim()) parts.push(`\n\n${text}\n\n`);
                continue;
            }

            // ── Horizontal rule ──
            if (tag === 'HR') {
                parts.push('\n\n---\n\n');
                continue;
            }

            // ── Lists ──
            if (tag === 'UL' || tag === 'OL') {
                parts.push('\n');
                const items = el.querySelectorAll(':scope > li');
                items.forEach((li, idx) => {
                    const indent = '  '.repeat(listDepth);
                    const bullet = tag === 'OL' ? `${idx + 1}. ` : '- ';
                    const text = this._inlineToMarkdown(li);
                    parts.push(`${indent}${bullet}${text}\n`);

                    // Handle block-level children (nested lists, code blocks, tables)
                    for (const child of Array.from(li.children)) {
                        const childTag = child.tagName?.toUpperCase() || '';
                        if (childTag === 'UL' || childTag === 'OL') {
                            this._walkNodes({ childNodes: [child] }, parts, listDepth + 1);
                        } else if (childTag === 'PRE' || childTag === 'TABLE' ||
                            childTag === 'BLOCKQUOTE') {
                            this._walkNodes({ childNodes: [child] }, parts, listDepth);
                        }
                    }
                });
                parts.push('\n');
                continue;
            }

            // ── Blockquote ──
            if (tag === 'BLOCKQUOTE') {
                const innerMd = this._domToMarkdown(el);
                const quoted = innerMd.split('\n').map(l => `> ${l}`).join('\n');
                parts.push(`\n\n${quoted}\n\n`);
                continue;
            }

            // ── Bold / Strong ──
            if (tag === 'STRONG' || tag === 'B') {
                parts.push(`**${this._inlineToMarkdown(el)}**`);
                continue;
            }

            // ── Italic / Em ──
            if (tag === 'EM' || tag === 'I') {
                parts.push(`*${this._inlineToMarkdown(el)}*`);
                continue;
            }

            // ── Inline code ──
            if (tag === 'CODE' && !el.closest('pre')) {
                parts.push(`\`${el.textContent || ''}\``);
                continue;
            }

            // ── Links ──
            if (tag === 'A') {
                const href = el.getAttribute('href') || '';
                const text = el.textContent?.trim() || href;
                parts.push(href ? `[${text}](${this._safeUrl(href)})` : text);
                continue;
            }

            // ── Image ──
            if (tag === 'IMG') {
                const src = el.getAttribute('src') || '';
                const alt = el.getAttribute('alt') || 'Image';
                if (src) parts.push(`\n\n![${alt}](${this._safeUrl(src)})\n\n`);
                continue;
            }

            // ── Line break ──
            if (tag === 'BR') {
                parts.push('\n');
                continue;
            }

            // ── Generic containers — recurse ──
            if (el.children && el.children.length > 0) {
                this._walkNodes(el, parts, listDepth);
            } else {
                const text = (el.textContent || '').trim();
                if (text) parts.push(text);
            }
        }
    }

    /**
     * Extract LaTeX source from a KaTeX-rendered element.
     * Tries multiple strategies:
     *   1. <annotation encoding="application/x-tex"> (standard KaTeX)
     *   2. data-math attribute (Gemini-style, some Claude versions)
     *   3. Any <annotation> element (MathML fallback)
     */
    _extractLatex(el) {
        // Strategy 1: annotation with TeX encoding (standard KaTeX)
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation?.textContent?.trim()) return annotation.textContent.trim();
        // Strategy 2: data-math attribute
        const dataMath = el.getAttribute?.('data-math');
        if (dataMath) return dataMath;
        // Strategy 3: any annotation element (MathML)
        const mathAnnotation = el.querySelector('annotation');
        if (mathAnnotation?.textContent?.trim()) return mathAnnotation.textContent.trim();
        return '';
    }

    /**
     * Convert inline content to markdown text (within <p>, <li>, headings, etc.).
     * Recursively walks inline DOM elements.
     */
    _inlineToMarkdown(el) {
        const parts = [];
        const nodes = el.childNodes ? Array.from(el.childNodes) : [];

        for (const node of nodes) {
            if (node.nodeType === 3) {
                parts.push(node.textContent || '');
                continue;
            }
            if (node.nodeType !== 1) continue;

            const tag = node.tagName?.toUpperCase() || '';

            // Skip buttons, SVGs, UI chrome
            if (tag === 'BUTTON' || tag === 'SVG') continue;

            // Skip block-level elements — handled by _walkNodes in list handler
            if (tag === 'UL' || tag === 'OL' || tag === 'LI' ||
                tag === 'PRE' || tag === 'TABLE' || tag === 'BLOCKQUOTE') {
                continue;
            }

            // KaTeX display math in inline context
            if (node.classList?.contains('katex-display') ||
                (node.classList?.contains('math') && node.classList?.contains('math-display')) ||
                node.classList?.contains('math-block')) {
                const latex = this._extractLatex(node);
                if (latex) { parts.push(`$$${latex}$$`); continue; }
                continue;
            }

            // KaTeX inline math
            if ((node.classList?.contains('katex') && !node.closest('.katex-display')) ||
                (node.classList?.contains('math') && node.classList?.contains('math-inline')) ||
                node.classList?.contains('math-inline') ||
                (node.hasAttribute?.('data-math') && !node.classList?.contains('math-block'))) {
                const latex = this._extractLatex(node);
                if (latex) { parts.push(`$${latex}$`); continue; }
                continue;
            }

            if (tag === 'STRONG' || tag === 'B') {
                parts.push(`**${this._inlineToMarkdown(node)}**`);
                continue;
            }
            if (tag === 'EM' || tag === 'I') {
                parts.push(`*${this._inlineToMarkdown(node)}*`);
                continue;
            }
            if (tag === 'CODE' && !node.closest('pre')) {
                parts.push(`\`${node.textContent || ''}\``);
                continue;
            }
            if (tag === 'A') {
                const href = node.getAttribute('href') || '';
                const text = node.textContent?.trim() || href;
                parts.push(href ? `[${text}](${this._safeUrl(href)})` : text);
                continue;
            }
            if (tag === 'BR') {
                parts.push('\n');
                continue;
            }
            // Recurse for other inline elements
            parts.push(this._inlineToMarkdown(node));
        }
        return parts.join('');
    }

    /**
     * Convert an HTML <table> to markdown table syntax.
     */
    _tableToMarkdown(table) {
        const rows = [];
        const headerCells = Array.from(table.querySelectorAll('thead tr th, thead tr td'));
        if (headerCells.length > 0) {
            rows.push(headerCells.map(c => this._inlineToMarkdown(c).trim()));
        }
        const bodyRows = table.querySelectorAll('tbody tr');
        bodyRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            rows.push(cells.map(c => this._inlineToMarkdown(c).trim()));
        });
        if (rows.length === 0) return '';
        const lines = [];
        lines.push('| ' + rows[0].join(' | ') + ' |');
        lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
        for (let i = 1; i < rows.length; i++) {
            lines.push('| ' + rows[i].join(' | ') + ' |');
        }
        return lines.join('\n');
    }

    // ─── Role / selector helpers ──────────────────────────────

    _isHumanNode(el) {
        return USER_SELECTORS.some(sel => {
            try {
                return !!el.closest(sel);
            } catch {
                return false;
            }
        });
    }

    _queryAll(selectors) {
        const out = [];
        for (const sel of selectors) {
            try {
                out.push(...Array.from(document.querySelectorAll(sel)));
            } catch {
                // ignore invalid selector edge cases
            }
        }
        return out;
    }

    _dedupeTopLevel(nodes) {
        const unique = Array.from(new Set(nodes));
        // Keep only top-level matches so child spans don't duplicate parent message text.
        return unique.filter(node => !unique.some(other => other !== node && other.contains(node)));
    }

    _compareDomOrder(a, b) {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    }

    _assistantCount() {
        // Primary: count turns that contain a .font-claude-response element
        const turnBased = document.querySelectorAll('div[data-test-render-count] .font-claude-response');
        if (turnBased.length > 0) return turnBased.length;
        // Fallback: old approach
        const assistantNodes = this._dedupeTopLevel(
            this._queryAll(ASSISTANT_SELECTORS).filter(el => !this._isHumanNode(el))
        );
        return assistantNodes.length;
    }

    _findConversationRoot() {
        for (const sel of CONVERSATION_ROOT_SELECTORS) {
            try {
                const match = document.querySelector(sel);
                if (match) return match;
            } catch {
                // ignore
            }
        }
        return null;
    }

    /**
     * Extract text from a message element, using DOM walking for assistant
     * messages (preserves math, code, formatting) and innerText for user messages.
     * @param {Element} el
     * @param {string} role - 'user' or 'assistant'
     * @returns {string}
     */
    _extractText(el, role) {
        // Use DOM walking for all roles to preserve LaTeX, markdown,
        // and special formatting in both user and assistant messages
        const md = this._domToMarkdown(el);
        if (md && md.length > 0) return md;
        return el?.innerText?.trim() || '';
    }

    extract() {
        // ── Title ──
        let title = document.title || "Untitled";
        // Primary: button[data-testid="chat-title-button"] .truncate (current Claude.ai)
        const titleEl =
            document.querySelector('[data-testid="chat-title-button"] .truncate') ||
            document.querySelector('[data-testid="chat-title-button"]') ||
            document.querySelector('div[class*="truncate"]') ||
            document.querySelector('[data-testid*="conversation-title"]') ||
            document.querySelector('h1');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // ── Strategy 0 (Primary): Turn-based extraction via data-test-render-count ──
        // Each turn is a div[data-test-render-count] containing either a
        // user message ([data-testid="user-message"]) or an assistant response
        // (.font-claude-response with .standard-markdown content inside).
        const turns = document.querySelectorAll('div[data-test-render-count]');
        if (turns.length > 0) {
            const messages = [];
            const lines = [];

            for (const turn of turns) {
                // Check for user message
                const userMsg = turn.querySelector('[data-testid="user-message"]');
                if (userMsg) {
                    const text = this._extractText(userMsg, 'user');
                    if (text) {
                        messages.push({ role: 'user', text });
                        lines.push(`[USER]:\n${text}`);
                    }
                    continue;
                }

                // Check for assistant response
                const assistantResponse = turn.querySelector('.font-claude-response');
                if (assistantResponse) {
                    // Prefer .standard-markdown content blocks for clean extraction
                    const markdownBlocks = assistantResponse.querySelectorAll('.standard-markdown');
                    let text = '';
                    if (markdownBlocks.length > 0) {
                        const blockTexts = [];
                        for (const block of markdownBlocks) {
                            const blockMd = this._domToMarkdown(block);
                            if (blockMd) blockTexts.push(blockMd);
                        }
                        text = blockTexts.join('\n\n');
                    }
                    // Fallback: extract from the entire response container
                    if (!text) {
                        text = this._extractText(assistantResponse, 'assistant');
                    }
                    if (text) {
                        messages.push({ role: 'assistant', text });
                        lines.push(`[ASSISTANT]:\n${text}`);
                    }
                }
            }

            if (messages.length && messages.some(m => m.role === 'assistant')) {
                return {
                    title,
                    content: lines.join('\n\n---\n\n'),
                    platform: "claude",
                    messages
                };
            }
        }

        // ── Strategy 1: Selector-based extraction (fallback) ──
        // Collect user + assistant nodes via resilient selector sets,
        // then merge by document order.
        const humanTurns = this._dedupeTopLevel(this._queryAll(USER_SELECTORS));
        const assistantCandidates = this._dedupeTopLevel(
            this._queryAll(ASSISTANT_SELECTORS).filter(el => !this._isHumanNode(el))
        );

        if (humanTurns.length || assistantCandidates.length) {
            const nodeMap = new Map();

            humanTurns.forEach(el => nodeMap.set(el, { el, role: 'user' }));
            assistantCandidates.forEach(el => nodeMap.set(el, { el, role: 'assistant' }));

            const allNodes = Array.from(nodeMap.values());
            allNodes.sort((a, b) => this._compareDomOrder(a.el, b.el));

            const messages = [];
            const lines = [];
            for (const { el, role } of allNodes) {
                const text = this._extractText(el, role);
                if (!text) continue;
                messages.push({ role, text });
                lines.push(`[${role.toUpperCase()}]:\n${text}`);
            }

            if (messages.length && messages.some(m => m.role === 'assistant')) {
                return {
                    title,
                    content: lines.join('\n\n---\n\n'),
                    platform: "claude",
                    messages
                };
            }
        }

        // ── Strategy 2: Walk direct children of conversation root ──
        const conversationRoot = this._findConversationRoot();
        if (conversationRoot?.children?.length) {
            const messages = [];
            const lines = [];
            let lastRole = 'assistant';

            for (const child of Array.from(conversationRoot.children)) {
                const hasHuman = USER_SELECTORS.some(sel => {
                    try {
                        return child.matches?.(sel) || !!child.querySelector?.(sel);
                    } catch {
                        return false;
                    }
                });
                const hasAssistant = ASSISTANT_SELECTORS.some(sel => {
                    try {
                        return (child.matches?.(sel) || !!child.querySelector?.(sel)) && !this._isHumanNode(child);
                    } catch {
                        return false;
                    }
                });

                let role;
                if (hasHuman) role = 'user';
                else if (hasAssistant) role = 'assistant';
                else role = lastRole === 'assistant' ? 'user' : 'assistant';

                const text = this._extractText(child, role);
                if (!text) continue;

                lastRole = role;
                messages.push({ role, text });
                lines.push(`[${role.toUpperCase()}]:\n${text}`);
            }

            if (messages.length && messages.some(m => m.role === 'assistant')) {
                return {
                    title,
                    content: lines.join('\n\n---\n\n'),
                    platform: "claude",
                    messages
                };
            }
        }

        // Fallback: grid container or conversation wrapper
        const grid = this._findConversationRoot() || document.querySelector('[class*="conversation"]');
        if (grid) {
            const text = grid.innerText?.trim();
            if (!text) throw new Error("Claude: fallback container is empty.");
            return { title, content: text, platform: "claude", messages: [] };
        }

        throw new Error("Claude: could not find conversation elements. Is this a conversation page?");
    }

    /**
     * Send a message to Claude by injecting text into the ProseMirror editor.
     * Claude uses a contenteditable div (ProseMirror) as its input field.
     * @param {string} text
     */
    sendMessage(text) {
        if (!text?.trim()) throw new Error("Cannot send empty message.");

        // Claude uses a ProseMirror contenteditable div
        // Primary: data-testid="chat-input" (current Claude.ai)
        const inputEl =
            document.querySelector('[data-testid="chat-input"]') ||
            document.querySelector('div.ProseMirror[contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][role="textbox"]') ||
            document.querySelector('[contenteditable="true"]');

        if (!inputEl) throw new Error("Claude: could not find input field. The page may have changed.");

        inputEl.focus();
        inputEl.innerHTML = `<p>${text}</p>`;
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));

        setTimeout(() => {
            const sendBtn =
                document.querySelector('button[aria-label="Send Message"]') ||
                document.querySelector('button[aria-label*="Send message"]') ||
                document.querySelector('button[aria-label*="Send"]') ||
                document.querySelector('button[aria-label*="send"]');

            if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
            } else {
                inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter',
                    keyCode: 13, which: 13,
                    bubbles: true, cancelable: true
                }));
            }

            setTimeout(() => {
                inputEl.innerHTML = '';
            }, 300);
        }, 200);
    }

    /**
     * Wait for Claude to finish streaming its response.
     * Resolves when streaming indicator disappears, send button re-appears,
     * DOM mutations settle for 2 s, or on timeout.
     * @param {number} maxWaitMs
     */
    waitForResponse(maxWaitMs = 60000) {
        return new Promise((resolve) => {
            const startCount = this._assistantCount();
            let settled = false;
            let settleTimer = null;
            let mutationSeen = false;
            let sendButtonReady = false;
            const SETTLE_DELAY = 2000;

            const target =
                document.querySelector('[data-testid="conversation-content"]') ||
                document.querySelector('[data-autoscroll-container]') ||
                document.querySelector('main') ||
                document.body;

            const observer = new MutationObserver(() => {
                mutationSeen = true;
                if (sendButtonReady) return;
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => finish(), SETTLE_DELAY);
            });

            observer.observe(target, { childList: true, subtree: true, characterData: true });

            const maxTimer = setTimeout(() => {
                console.log('[REXOW] Claude waitForResponse: max timeout reached');
                finish();
            }, maxWaitMs);

            const checkInterval = setInterval(() => {
                const currentCount = this._assistantCount();
                if (currentCount > startCount && !settleTimer && mutationSeen) {
                    settleTimer = setTimeout(() => finish(), SETTLE_DELAY);
                }

                // Check streaming status via data-is-streaming attribute (current Claude.ai)
                const streamingEl = document.querySelector('[data-is-streaming="true"]');
                if (!streamingEl && mutationSeen && currentCount > startCount) {
                    console.log('[REXOW] Claude waitForResponse: streaming complete');
                    sendButtonReady = true;
                    finish();
                    return;
                }

                // Claude re-enables the send button once streaming is complete
                const sendBtn =
                    document.querySelector('button[aria-label="Send Message"]:not([disabled])') ||
                    document.querySelector('button[aria-label*="Send"]:not([disabled])');
                if (sendBtn && mutationSeen) {
                    console.log('[REXOW] Claude waitForResponse: send button re-enabled, finishing');
                    sendButtonReady = true;
                    finish();
                }
            }, 1000);

            function finish() {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(maxTimer);
                clearTimeout(settleTimer);
                clearInterval(checkInterval);
                resolve();
            }
        });
    }

    /**
     * Scroll the conversation to the bottom so the latest messages are rendered.
     */
    prepareForExtract() {
        // Primary: autoscroll container (current Claude.ai)
        const container =
            document.querySelector('[data-autoscroll-container]') ||
            document.querySelector('[data-testid="conversation-content"]') ||
            document.querySelector('[class*="conversation"]') ||
            document.querySelector('main');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
        window.scrollTo(0, document.body.scrollHeight);
    }
}
