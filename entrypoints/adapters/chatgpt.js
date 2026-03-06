/**
 * adapters/chatgpt.js — ChatGPT Content Adapter
 *
 * Extracts conversation content from ChatGPT pages, converting rich HTML
 * (code blocks, LaTeX, tables, formatting) back to clean Markdown so
 * it renders correctly in the dashboard via marked + KaTeX.
 */
export default class ChatGPTAdapter {
    constructor() { this.name = "ChatGPT"; }

    // ─── DOM-to-Markdown helpers ──────────────────────────────

    /**
     * Convert a ChatGPT DOM element tree to clean markdown text.
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

            // Skip buttons, copy elements, etc.
            if (tag === 'BUTTON' || tag === 'NAV' || tag === 'HEADER' ||
                el.classList?.contains('copy-code-button') ||
                el.classList?.contains('result-streaming')) continue;

            // ── KaTeX display math (block) ──
            // ChatGPT wraps display math in <span class="katex-display">
            // or <div class="math math-display"> containing <annotation> with LaTeX source
            if (el.classList?.contains('katex-display') ||
                (el.classList?.contains('math') && el.classList?.contains('math-display'))) {
                const latex = this._extractLatex(el);
                if (latex) { parts.push(`\n\n$$\n${latex}\n$$\n\n`); continue; }
                if (el.classList?.contains('katex-display') || el.querySelector('.katex')) continue;
            }

            // ── KaTeX inline math ──
            // <span class="katex"> or <span class="math math-inline">
            if ((el.classList?.contains('katex') && !el.closest('.katex-display')) ||
                (el.classList?.contains('math') && el.classList?.contains('math-inline'))) {
                const latex = this._extractLatex(el);
                if (latex) { parts.push(`$${latex}$`); continue; }
                if (el.classList?.contains('katex') || el.querySelector('.katex')) continue;
            }

            // ── Code block: <pre> ──
            if (tag === 'PRE') {
                const codeEl = el.querySelector('code');
                // Use innerText to preserve visual line breaks (ChatGPT
                // wraps code lines in <div>/<span> elements; textContent
                // concatenates them without newlines)
                const code = codeEl?.innerText || codeEl?.textContent || el.innerText || el.textContent || '';
                let lang = '';
                const className = (codeEl?.className || '').toLowerCase();
                const langMatch = className.match(/language-([a-z0-9_+-]+)/);
                if (langMatch) lang = langMatch[1];
                // Try to get language from the header bar
                if (!lang) {
                    const header = el.querySelector('.code-block-header, [class*="code-header"], [class*="text-token-text-secondary"]');
                    if (header) lang = (header.textContent || '').trim().split('\n')[0].trim().toLowerCase();
                }
                // Strip language label text that may appear at the start of code
                // when the header is inside the <pre> and captured by innerText
                let cleanCode = code;
                if (lang) {
                    const lines = cleanCode.split('\n');
                    const first = (lines[0] || '').trim().toLowerCase();
                    if (first === lang.toLowerCase()) {
                        lines.shift();
                        cleanCode = lines.join('\n');
                    }
                }
                // Some ChatGPT themes show a visible language line (e.g. "Bash")
                // that differs from detected lang class (e.g. "shell").
                const codeLines = cleanCode.split('\n');
                const firstLineRaw = (codeLines[0] || '').trim();
                const firstLine = firstLineRaw.toLowerCase();
                const langAliases = new Set([
                    'bash', 'sh', 'shell', 'zsh', 'fish',
                    'javascript', 'js', 'typescript', 'ts',
                    'python', 'py', 'rust', 'rs', 'go', 'java', 'c', 'cpp', 'c++',
                    'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sql', 'php',
                    'latex', 'tex', 'markdown', 'md',
                    'ruby', 'rb', 'swift', 'kotlin', 'r', 'lua',
                    'perl', 'scala', 'dart', 'makefile', 'dockerfile',
                    'graphql', 'toml', 'ini', 'csv', 'plaintext', 'text'
                ]);
                if (codeLines.length > 1 && langAliases.has(firstLine)) {
                    codeLines.shift();
                    cleanCode = codeLines.join('\n');
                    if (!lang) lang = firstLine === 'sh' ? 'bash' : firstLine;
                }
                // Also strip common header decorations (e.g., "Copy code" button text)
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

                    // Process block-level children (nested lists, code blocks, tables)
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
                parts.push(href ? `[${text}](${href})` : text);
                continue;
            }

            // ── Image ──
            if (tag === 'IMG') {
                const src = el.getAttribute('src') || '';
                const alt = el.getAttribute('alt') || 'Image';
                if (src) parts.push(`\n\n![${alt}](${src})\n\n`);
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
     * ChatGPT puts the original TeX in <annotation encoding="application/x-tex">.
     */
    _extractLatex(el) {
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation?.textContent?.trim()) return annotation.textContent.trim();
        // Fallback: try MathML semantics annotation
        const mathAnnotation = el.querySelector('annotation');
        if (mathAnnotation?.textContent?.trim()) return mathAnnotation.textContent.trim();
        return '';
    }

    /**
     * Convert inline content to markdown text (within <p>, <li>, headings, etc.).
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

            if (tag === 'BUTTON') continue;

            // Skip block-level elements — they are handled by _walkNodes
            // in the list handler (nested lists, code blocks, tables, etc.)
            if (tag === 'UL' || tag === 'OL' || tag === 'LI' ||
                tag === 'PRE' || tag === 'TABLE' || tag === 'BLOCKQUOTE') {
                continue;
            }

            // Inline KaTeX math
            if (node.classList?.contains('katex') && !node.closest('.katex-display')) {
                const latex = this._extractLatex(node);
                if (latex) { parts.push(`$${latex}$`); continue; }
                continue;
            }
            if (node.classList?.contains('katex-display') ||
                (node.classList?.contains('math') && node.classList?.contains('math-display'))) {
                const latex = this._extractLatex(node);
                if (latex) { parts.push(`$$${latex}$$`); continue; }
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
                parts.push(href ? `[${text}](${href})` : text);
                continue;
            }
            if (tag === 'BR') {
                parts.push('\n');
                continue;
            }
            // Recurse
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

            let text;
            if (role === 'assistant') {
                // Walk the DOM to preserve code blocks, LaTeX, tables, formatting
                text = this._domToMarkdown(node);
            } else {
                // User messages: plain text is sufficient
                text = node.innerText?.trim() || '';
            }

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

    /**
     * Send a message to ChatGPT by injecting text into the input field and clicking Send.
     * ChatGPT uses a contenteditable <div id="prompt-textarea"> in modern versions,
     * or a plain <textarea> in older ones.
     * @param {string} text
     */
    sendMessage(text) {
        if (!text?.trim()) throw new Error("Cannot send empty message.");

        const inputEl =
            document.querySelector('#prompt-textarea') ||
            document.querySelector('div[contenteditable="true"][data-id="root"]') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('textarea[placeholder*="Send"]') ||
            document.querySelector('textarea');

        if (!inputEl) throw new Error("ChatGPT: could not find input field. The page may have changed.");

        inputEl.focus();

        if (inputEl.tagName === 'TEXTAREA') {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            // contenteditable div — insert as paragraph so React picks up the change
            inputEl.innerHTML = `<p>${text}</p>`;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        setTimeout(() => {
            const sendBtn =
                document.querySelector('button[data-testid="send-button"]') ||
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
                if (inputEl.tagName === 'TEXTAREA') {
                    inputEl.value = '';
                } else {
                    inputEl.innerHTML = '';
                }
            }, 300);
        }, 200);
    }

    /**
     * Wait for ChatGPT to finish streaming its response.
     * Resolves when the send button re-appears (streaming done),
     * or after DOM mutations settle for 2 s, or on timeout.
     * @param {number} maxWaitMs
     */
    waitForResponse(maxWaitMs = 60000) {
        return new Promise((resolve) => {
            const startCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
            let settled = false;
            let settleTimer = null;
            let mutationSeen = false;
            let sendButtonReady = false;
            const SETTLE_DELAY = 2000;

            const target =
                document.querySelector('main') ||
                document.querySelector('[role="main"]') ||
                document.body;

            const observer = new MutationObserver(() => {
                mutationSeen = true;
                if (sendButtonReady) return;
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => finish(), SETTLE_DELAY);
            });

            observer.observe(target, { childList: true, subtree: true, characterData: true });

            const maxTimer = setTimeout(() => {
                console.log('[REXOW] ChatGPT waitForResponse: max timeout reached');
                finish();
            }, maxWaitMs);

            const checkInterval = setInterval(() => {
                const currentCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
                if (currentCount > startCount && !settleTimer && mutationSeen) {
                    settleTimer = setTimeout(() => finish(), SETTLE_DELAY);
                }
                // ChatGPT re-enables the send button once streaming is complete
                const sendBtn = document.querySelector('button[data-testid="send-button"]:not([disabled])');
                if (sendBtn && mutationSeen) {
                    console.log('[REXOW] ChatGPT waitForResponse: send button re-enabled, finishing');
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
        const container =
            document.querySelector('main') ||
            document.querySelector('[role="main"]');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
        window.scrollTo(0, document.body.scrollHeight);
    }
}
