/**
 * adapters/gemini.js — Google Gemini Content Adapter
 *
 * DOM Strategy (2024+):
 *   1. Search the ENTIRE document for <user-query> and <model-response> custom elements.
 *   2. For assistant messages: walk the DOM tree and convert back to markdown text,
 *      preserving LaTeX ($...$, $$...$$), code fences, tables, links, and formatting.
 *   3. For user messages: extract plain text from query-text-line elements.
 *   4. Fallback: filter raw innerText of a conversation container.
 *
 * How Gemini renders content:
 *   - Math blocks:  <div class="math-block" data-math="LaTeX source">...</div>
 *   - Inline math:  <span class="math-inline" data-math="LaTeX source">...</span>
 *   - Code blocks:  <code-block> → code[role="text"] inside
 *   - Tables:       <table-block> or <table> inside a response-element
 *   - Links:        standard <a href="..."> tags
 *   - Headers:      <h1>-<h6>
 *   - Lists:        <ul>/<ol> with <li>
 *   - Bold/Italic:  <strong>/<em> or <b>/<i>
 *   - Inline code:  <code> (not inside <pre>)
 */

const NOISE_LINES = new Set([
    'Show drafts', 'Regenerate', 'Modify response', 'Listen',
    'Share', 'More', 'thumb_up', 'thumb_down', 'content_copy',
    'Google', 'Report a legal issue', 'volume_up', 'Edit in Docs',
    'flag', 'Share & export', 'Edit query', 'close',
]);

/** Elements to skip during DOM traversal */
const SKIP_TAGS = new Set([
    'BUTTON', 'MAT-ICON', 'SOURCES-CAROUSEL-INLINE', 'SOURCE-INLINE-CHIPS',
    'SOURCE-INLINE-CHIP', 'SHARE-BUTTON', 'COPY-BUTTON',
    'DOWNLOAD-GENERATED-IMAGE-BUTTON', 'MODEL-THOUGHTS',
]);
const SKIP_CLASSES = new Set([
    'copy-button', 'action-button', 'table-footer', 'export-sheets-button',
    'thoughts-header', 'source-inline-chip-container', 'model-thoughts',
    'hide-from-message-actions', 'generated-image-controls',
]);

export default class GeminiAdapter {
    constructor() { this.name = "Gemini"; }

    _imageMarkdown(src, alt = 'Image') {
        if (!src) return '';
        const safeSrc = String(src).replace(/\s/g, '%20').replace(/\)/g, '%29');
        return `\n\n![${alt}](${safeSrc})\n\n`;
    }

    /**
     * Strip known prefixes from user query text (e.g. "你說了" added by Gemini UI).
     */
    _cleanUserText(text) {
        return text.replace(/^你說了\s*/, '');
    }

    /**
     * Check if a DOM element should be skipped during content extraction.
     */
    _shouldSkip(el) {
        if (SKIP_TAGS.has(el.tagName)) return true;
        for (const cls of SKIP_CLASSES) {
            if (el.classList?.contains(cls)) return true;
        }
        return false;
    }

    /**
     * Convert a Gemini DOM element tree to clean markdown text.
     * Walks child elements recursively, converting each to markdown syntax.
     * 
     * @param {Element} container - The DOM element to convert
     * @returns {string} Markdown text
     */
    _domToMarkdown(container) {
        const parts = [];
        this._walkNodes(container, parts, 0);
        return parts.join('')
            .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
            .trim();
    }

    /**
     * Recursively walk DOM nodes and convert to markdown.
     * @param {Element|Node} node
     * @param {string[]} parts - accumulator
     * @param {number} listDepth - nesting level for lists
     */
    _walkNodes(node, parts, listDepth) {
        const children = node.childNodes ? Array.from(node.childNodes) : [];

        for (const child of children) {
            // Text node
            if (child.nodeType === 3) { // TEXT_NODE
                const text = child.textContent || '';
                if (text.trim()) {
                    parts.push(text);
                }
                continue;
            }

            // Not an element node
            if (child.nodeType !== 1) continue; // ELEMENT_NODE

            const el = child;
            const tag = el.tagName?.toUpperCase() || '';

            // Skip unwanted elements
            if (this._shouldSkip(el)) continue;

            // ── Math block (display equation) ──
            if (el.classList?.contains('math-block')) {
                const latex = el.getAttribute('data-math') || '';
                if (latex) {
                    parts.push(`\n\n$$\n${latex}\n$$\n\n`);
                    continue;
                }
            }

            // ── Inline math ──
            if (el.classList?.contains('math-inline') || (el.hasAttribute?.('data-math') && !el.classList?.contains('math-block'))) {
                const latex = el.getAttribute('data-math') || '';
                if (latex) {
                    parts.push(`$${latex}$`);
                    continue;
                }
            }

            // ── Code block ──
            if (tag === 'CODE-BLOCK' || el.classList?.contains('code-block')) {
                const codeEl = el.querySelector('code[role="text"], code');
                // Use innerText to preserve visual line breaks; fall back to textContent
                let code = codeEl?.innerText || codeEl?.textContent || el.innerText || el.textContent || '';
                // Try to detect language
                let lang = '';
                const langLabel = el.querySelector('.code-block-decoration');
                if (langLabel) {
                    lang = (langLabel.textContent || '').trim().toLowerCase();
                    // Remove decoration text that may appear at the start of code content
                    const decorText = (langLabel.textContent || '').trim();
                    if (decorText && code.startsWith(decorText)) {
                        code = code.slice(decorText.length).trim();
                    }
                }
                parts.push(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`);
                continue;
            }

            // ── Table ──
            // Only match direct TABLE or TABLE-BLOCK elements.
            // Do NOT use el.querySelector('table') here — that would match any
            // container (like a <div>) that has a table deep inside, causing
            // all other content in that container to be skipped.
            if (tag === 'TABLE-BLOCK' || tag === 'TABLE') {
                const table = tag === 'TABLE' ? el : el.querySelector('table');
                if (table) {
                    const md = this._tableToMarkdown(table);
                    if (md) {
                        parts.push(`\n\n${md}\n\n`);
                        continue;
                    }
                }
                // If no table found, fall through to recurse
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
                if (text.trim()) {
                    parts.push(`\n\n${text}\n\n`);
                }
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

                    // Process block-level children (including wrappers that contain them)
                    for (const child of Array.from(li.children)) {
                        const childTag = child.tagName?.toUpperCase() || '';
                        if (childTag === 'UL' || childTag === 'OL') {
                            this._walkNodes({ childNodes: [child] }, parts, listDepth + 1);
                        } else if (childTag === 'CODE-BLOCK' || child.classList?.contains('code-block') ||
                                   childTag === 'PRE' || childTag === 'TABLE' || childTag === 'TABLE-BLOCK' ||
                                   childTag === 'BLOCKQUOTE' || child.classList?.contains('math-block') ||
                                   child.querySelector('code-block, pre, table, table-block, blockquote, ul, ol, .math-block')) {
                            this._walkNodes({ childNodes: [child] }, parts, listDepth);
                        }
                    }
                });
                parts.push('\n');
                continue;
            }

            // ── Blockquote ──
            if (tag === 'BLOCKQUOTE') {
                // Recursively convert children to markdown to preserve
                // nested quotes, bold, lists, math, paragraph breaks, etc.
                const innerMd = this._domToMarkdown(el);
                const quoted = innerMd.split('\n').map(l => `> ${l}`).join('\n');
                parts.push(`\n\n${quoted}\n\n`);
                continue;
            }

            // ── Pre (code without code-block wrapper) ──
            if (tag === 'PRE') {
                const codeEl = el.querySelector('code');
                const code = codeEl?.textContent || el.textContent || '';
                let lang = '';
                const className = (codeEl?.className || '').toLowerCase();
                const langMatch = className.match(/language-([a-z0-9]+)/);
                if (langMatch) lang = langMatch[1];
                parts.push(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`);
                continue;
            }

            // ── Generic containers — recurse ──
            if (tag === 'RESPONSE-ELEMENT' || tag === 'DIV' || tag === 'SECTION' ||
                tag === 'ARTICLE' || tag === 'SPAN' || tag === 'MESSAGE-CONTENT' ||
                tag === 'MODEL-RESPONSE' || tag === 'USER-QUERY' ||
                el.classList?.contains('markdown') || el.classList?.contains('markdown-main-panel')) {
                this._walkNodes(el, parts, listDepth);
                continue;
            }

            // ── Bold / Strong ──
            if (tag === 'STRONG' || tag === 'B') {
                const text = this._inlineToMarkdown(el);
                parts.push(`**${text}**`);
                continue;
            }

            // ── Italic / Em ──
            if (tag === 'EM' || tag === 'I') {
                const text = this._inlineToMarkdown(el);
                parts.push(`*${text}*`);
                continue;
            }

            // ── Inline code ──
            if (tag === 'CODE') {
                const text = el.textContent || '';
                parts.push(`\`${text}\``);
                continue;
            }

            // ── Links ──
            if (tag === 'A') {
                const href = el.getAttribute('href') || '';
                const imgInLink = el.querySelector('img');
                if (imgInLink) {
                    const src = imgInLink.getAttribute('src') || imgInLink.getAttribute('data-src') || '';
                    const alt = imgInLink.getAttribute('alt') || 'Image';
                    if (src) {
                        parts.push(this._imageMarkdown(src, alt));
                        continue;
                    }
                }
                const text = el.textContent?.trim() || href;
                if (href) {
                    parts.push(`[${text}](${href})`);
                } else {
                    parts.push(text);
                }
                continue;
            }

            // ── Image ──
            if (tag === 'IMG') {
                const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
                const alt = el.getAttribute('alt') || 'Image';
                if (src) {
                    parts.push(this._imageMarkdown(src, alt));
                }
                continue;
            }

            // ── Generated / custom image elements (Gemini-specific) ──
            if (tag === 'GENERATED-IMAGE' || tag === 'PANIMG' ||
                tag === 'IMG-VIEWER' || tag === 'IMAGE-PREVIEW' ||
                el.classList?.contains('generated-image') ||
                el.classList?.contains('image-container')) {
                // Try to find an <img> inside the custom element
                const imgEl = el.querySelector('img');
                const src = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') ||
                            el.getAttribute('src') || el.getAttribute('data-src') || '';
                const alt = imgEl?.getAttribute('alt') || el.getAttribute('alt') || 'Generated Image';
                if (src) {
                    parts.push(this._imageMarkdown(src, alt));
                    continue;
                }
                // Canvas-based images: try to extract data URL
                const canvas = el.querySelector('canvas');
                if (canvas) {
                    try {
                        const dataUrl = canvas.toDataURL?.();
                        if (dataUrl && dataUrl !== 'data:,') {
                            parts.push(this._imageMarkdown(dataUrl, 'Generated Image'));
                            continue;
                        }
                    } catch (_) { /* canvas tainted, skip */ }
                }
                // If we can't get the image, note its presence
                parts.push('\n\n*[Image]*\n\n');
                continue;
            }

            // ── Line break ──
            if (tag === 'BR') {
                parts.push('\n');
                continue;
            }

            // ── Default: recurse into unknown elements ──
            if (el.children && el.children.length > 0) {
                this._walkNodes(el, parts, listDepth);
            } else {
                // Leaf element — extract text
                const text = (el.textContent || '').trim();
                if (text && !NOISE_LINES.has(text)) {
                    parts.push(text);
                }
            }
        }
    }

    /**
     * Convert inline content (within a <p>, <li>, heading, etc.) to markdown text.
     * Handles inline math, code, bold, italic, links.
     */
    _inlineToMarkdown(el) {
        const parts = [];
        const nodes = el.childNodes ? Array.from(el.childNodes) : [];

        for (const node of nodes) {
            if (node.nodeType === 3) { // TEXT_NODE
                parts.push(node.textContent || '');
                continue;
            }
            if (node.nodeType !== 1) continue;

            const tag = node.tagName?.toUpperCase() || '';

            if (this._shouldSkip(node)) continue;

            // Skip block-level elements — they are handled by _walkNodes
            // in the list handler (nested lists, code blocks, tables, etc.)
            if (tag === 'UL' || tag === 'OL' || tag === 'LI' ||
                tag === 'CODE-BLOCK' || tag === 'PRE' ||
                tag === 'TABLE' || tag === 'TABLE-BLOCK' ||
                tag === 'BLOCKQUOTE' ||
                node.classList?.contains('code-block')) {
                continue;
            }

            if (node.querySelector?.('code-block, pre, table, table-block, blockquote, ul, ol, .math-block')) {
                continue;
            }

            // Inline math
            if (node.classList?.contains('math-inline') ||
                (node.hasAttribute?.('data-math') && !node.classList?.contains('math-block'))) {
                const latex = node.getAttribute('data-math') || '';
                if (latex) { parts.push(`$${latex}$`); continue; }
            }

            // Math block inside inline context
            if (node.classList?.contains('math-block')) {
                const latex = node.getAttribute('data-math') || '';
                if (latex) { parts.push(`$$${latex}$$`); continue; }
            }

            // Bold
            if (tag === 'STRONG' || tag === 'B') {
                parts.push(`**${this._inlineToMarkdown(node)}**`);
                continue;
            }

            // Italic
            if (tag === 'EM' || tag === 'I') {
                parts.push(`*${this._inlineToMarkdown(node)}*`);
                continue;
            }

            // Inline code
            if (tag === 'CODE') {
                parts.push(`\`${node.textContent || ''}\``);
                continue;
            }

            // Link
            if (tag === 'A') {
                const href = node.getAttribute('href') || '';
                const text = node.textContent?.trim() || href;
                parts.push(href ? `[${text}](${href})` : text);
                continue;
            }

            // BR
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
     * Convert an HTML table element to markdown table syntax.
     * Uses _inlineToMarkdown for cells to preserve LaTeX math.
     */
    _tableToMarkdown(table) {
        const rows = [];

        // Header row
        const headerCells = Array.from(table.querySelectorAll('thead tr th, thead tr td'));
        if (headerCells.length > 0) {
            rows.push(headerCells.map(c => this._inlineToMarkdown(c).trim()));
        }

        // Body rows
        const bodyRows = table.querySelectorAll('tbody tr');
        bodyRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            rows.push(cells.map(c => this._inlineToMarkdown(c).trim()));
        });

        if (rows.length === 0) return '';

        // If no thead, use first row as header
        const lines = [];
        lines.push('| ' + rows[0].join(' | ') + ' |');
        lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
        for (let i = 1; i < rows.length; i++) {
            lines.push('| ' + rows[i].join(' | ') + ' |');
        }
        return lines.join('\n');
    }

    extract() {
        // Title
        let title = document.title || "Untitled";
        const titleEl =
            document.querySelector('h1[class*="conversation-title"]') ||
            document.querySelector('.conversation-title') ||
            document.querySelector('[data-conversation-title]');
        if (titleEl?.innerText?.trim()) title = titleEl.innerText.trim();

        // ── Step 1: Search for structured message elements ──
        const messageNodes = document.querySelectorAll('user-query, model-response');

        if (messageNodes.length > 0) {
            const messages = [];
            const fullContent = [];

            for (const node of messageNodes) {
                const tagName = node.tagName.toLowerCase();
                const role = tagName === 'user-query' ? 'user' : 'assistant';

                let cleanedText = '';

                if (role === 'assistant') {
                    // For assistant messages: walk the DOM and convert to markdown
                    // to preserve LaTeX, code blocks, tables, links, etc.
                    const contentEl =
                        node.querySelector('message-content') ||
                        node.querySelector('.markdown-main-panel') ||
                        node.querySelector('.markdown') ||
                        node.querySelector('.model-response-text') ||
                        node;

                    cleanedText = this._domToMarkdown(contentEl);
                } else {
                    // For user messages: extract plain text
                    const textLines = node.querySelectorAll('.query-text-line');
                    if (textLines.length > 0) {
                        cleanedText = Array.from(textLines)
                            .map(line => (line.textContent || '').trim())
                            .filter(l => l.length > 0)
                            .join('\n');
                    } else {
                        const innerContent =
                            node.querySelector('.query-text') ||
                            node.querySelector('.query-content') ||
                            node;
                        cleanedText = (innerContent?.innerText?.trim() || '')
                            .split('\n')
                            .map(l => l.trim())
                            .filter(l => l.length > 0)
                            .filter(l => !NOISE_LINES.has(l))
                            .join('\n');
                    }
                    cleanedText = this._cleanUserText(cleanedText);
                }

                if (cleanedText) {
                    messages.push({ role, text: cleanedText });
                    fullContent.push(cleanedText);
                }
            }

            // Deduplicate trailing identical user queries
            if (messages.length >= 2) {
                const last = messages[messages.length - 1];
                if (last.role === 'user') {
                    for (let i = 0; i < messages.length - 1; i++) {
                        if (messages[i].role === 'user' && messages[i].text === last.text) {
                            messages.pop();
                            fullContent.pop();
                            break;
                        }
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
        const main = document.querySelector('[role="main"]');
        const textSource = main || document.body;
        const bodyText = textSource?.innerText?.trim() || '';

        if (bodyText.length < 100) {
            throw new Error("Gemini: page content too short. The page may still be loading.");
        }

        return { title, content: bodyText, platform: "gemini", messages: [] };
    }

    /**
     * Send a message to Gemini by injecting text into the input field and submitting.
     */
    sendMessage(text) {
        if (!text?.trim()) throw new Error("Cannot send empty message.");

        const inputEl =
            document.querySelector('rich-textarea .ql-editor') ||
            document.querySelector('.ql-editor[contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][aria-label]') ||
            document.querySelector('textarea[aria-label]');

        if (!inputEl) throw new Error("Gemini: could not find input field. The page may have changed.");

        inputEl.focus();

        if (inputEl.tagName === 'TEXTAREA') {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            inputEl.innerHTML = `<p>${text}</p>`;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        setTimeout(() => {
            const sendBtn =
                document.querySelector('.send-button') ||
                document.querySelector('button[aria-label="Send message"]') ||
                document.querySelector('button[aria-label*="Send"]') ||
                document.querySelector('button[aria-label*="send"]') ||
                document.querySelector('button.send-button') ||
                document.querySelector('[data-test-id="send-button"]');

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
                if (inputEl.tagName === 'TEXTAREA') {
                    inputEl.value = '';
                } else {
                    inputEl.innerHTML = '';
                }
            }, 300);
        }, 200);
    }

    /**
     * Wait for Gemini to finish its AI response.
     *
     * Strategy — **content-length stability + send-button polling**.
     * Gemini fires thousands of DOM mutations during streaming (character
     * data, attribute changes, UI animations) which made the old
     * MutationObserver settle-timer approach wait 10 s+ after the real
     * response was already complete.
     *
     * New approach:
     *  1. Poll every 300 ms for the send-button being re-enabled (instant).
     *  2. Track the last model-response element's *text length*. When the
     *     length stops changing for 2 consecutive checks (≈ 600 ms) AND a
     *     new response has appeared, resolve immediately.
     *  3. Max timeout fallback.
     *
     * No MutationObserver needed → no timer resets from noisy DOM changes.
     *
     * @param {number} maxWaitMs - Maximum time to wait (default 60 s)
     */
    waitForResponse(maxWaitMs = 60000) {
        return new Promise((resolve) => {
            const startCount = document.querySelectorAll('model-response').length;
            let settled = false;
            let prevLen = -1;
            let stableCount = 0;
            let sawStreaming = false;
            let streamingStartedAt = 0;
            let prevSendReady = isSendButtonReady();
            const STABLE_NEEDED = 4; // 4 × 300 ms = 1200 ms of stable content
            const MIN_STREAM_MS = 1200;

            function isSendButtonReady() {
                return !!(
                    document.querySelector('.send-button:not([disabled])') ||
                    document.querySelector('button[aria-label="Send message"]:not([disabled])') ||
                    document.querySelector('button[aria-label*="Send"]:not([disabled])') ||
                    document.querySelector('[data-test-id="send-button"]:not([disabled])') ||
                    document.querySelector('button.send-button:not([disabled])')
                );
            }

            const maxTimer = setTimeout(() => {
                console.log('[REXOW] waitForResponse: max timeout reached');
                finish();
            }, maxWaitMs);

            const poll = setInterval(() => {
                const responses = document.querySelectorAll('model-response');
                const hasNewResponse = responses.length > startCount;
                const sendBtnDisabled = !!(
                    document.querySelector('.send-button[disabled]') ||
                    document.querySelector('button[aria-label="Send message"][disabled]') ||
                    document.querySelector('button[aria-label*="Send"][disabled]') ||
                    document.querySelector('[data-test-id="send-button"][disabled]') ||
                    document.querySelector('button.send-button[disabled]')
                );

                if (hasNewResponse || sendBtnDisabled) {
                    if (!sawStreaming) streamingStartedAt = Date.now();
                    sawStreaming = true;
                }

                const sendReady = isSendButtonReady();
                const streamElapsed = sawStreaming ? (Date.now() - streamingStartedAt) : 0;

                // Fast path: send button became ready after being not-ready.
                // Do not finish just because it's currently ready; Gemini may
                // keep it ready while response text is still streaming.
                if (sendReady && !prevSendReady && sawStreaming && streamElapsed >= MIN_STREAM_MS) {
                    console.log('[REXOW] waitForResponse: send button ready');
                    finish();
                    return;
                }
                prevSendReady = sendReady;

                // Content-length stability check
                if (hasNewResponse) {
                    const last = responses[responses.length - 1];
                    const curLen = (last.textContent || '').length;
                    if (curLen === prevLen && curLen > 0) {
                        stableCount++;
                        if (stableCount >= STABLE_NEEDED && sawStreaming && streamElapsed >= MIN_STREAM_MS) {
                            console.log('[REXOW] waitForResponse: content stable');
                            finish();
                            return;
                        }
                    } else {
                        stableCount = 0;
                    }
                    prevLen = curLen;
                }
            }, 300);

            function finish() {
                if (settled) return;
                settled = true;
                clearTimeout(maxTimer);
                clearInterval(poll);
                resolve();
            }
        });
    }

    /**
     * Prepare the page for content extraction by scrolling to the bottom.
     */
    prepareForExtract() {
        const scroller =
            document.querySelector('infinite-scroller') ||
            document.querySelector('.conversation-container') ||
            document.querySelector('[role="main"]');

        if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }
        window.scrollTo(0, document.body.scrollHeight);
    }
}
