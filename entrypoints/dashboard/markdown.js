/**
 * markdown.js — Markdown + LaTeX + Syntax Highlighting
 *
 * Uses global libraries loaded via <script> tags in dashboard.html:
 *   - marked v11.2.0          → window.marked
 *   - marked-katex-ext v4.0.5 → window.markedKatex  (bundles katex internally)
 *   - highlight.js v11.9.0    → window.hljs
 */

let _initialized = false;

function ensureInit() {
    if (_initialized) return true;

    const _marked = window.marked;
    const _markedKatex = window.markedKatex;
    const _hljs = window.hljs;

    if (!_marked || typeof _marked.parse !== 'function') {
        console.warn("[REXOW] marked library not loaded");
        return false;
    }

    try {
        // Configure KaTeX extension for LaTeX rendering
        if (typeof _markedKatex === 'function') {
            _marked.use(_markedKatex({
                throwOnError: false
            }));
        } else {
            console.warn("[REXOW] markedKatex not loaded, LaTeX won't render");
        }

        // Configure highlight.js for code syntax highlighting
        if (_hljs) {
            _marked.use({
                renderer: {
                    code(text, lang) {
                        // `text` is the code string, `lang` is the language hint
                        const language = lang && _hljs.getLanguage(lang) ? lang : null;
                        try {
                            const highlighted = language
                                ? _hljs.highlight(text, { language }).value
                                : _hljs.highlightAuto(text).value;
                            return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`;
                        } catch {
                            return `<pre><code class="hljs">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
                        }
                    }
                }
            });
            console.log("[REXOW] Highlight.js initialized");
        } else {
            console.warn("[REXOW] highlight.js not loaded, code won't be highlighted");
        }

        _initialized = true;
        console.log("[REXOW] Markdown + KaTeX + highlight.js initialized");
        return true;
    } catch (e) {
        console.error("[REXOW] Markdown init error:", e);
        return false;
    }
}

/**
 * Parses raw markdown text into safe HTML, rendering LaTeX math blocks
 * and syntax-highlighted code blocks.
 * @param {string} text - The raw markdown text  
 * @returns {string} - The resulting HTML
 */
export function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    const ready = ensureInit();
    const _marked = window.marked;

    // If marked didn't load, return escaped text
    if (!ready || !_marked || typeof _marked.parse !== 'function') {
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    try {
        return _marked.parse(text);
    } catch (e) {
        console.error("[REXOW] Markdown rendering error:", e);
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
