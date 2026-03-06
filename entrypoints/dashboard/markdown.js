/**
 * markdown.js — Markdown + LaTeX + Syntax Highlighting
 *
 * Rendering Pipeline:
 *   1. Protect code fences (```) and inline code (`) from math extraction
 *   2. Extract display math ($$...$$) → numbered tokens
 *   3. Extract inline math ($...$) → numbered tokens
 *   4. Restore code protections (so marked handles them)
 *   5. Parse markdown with marked + highlight.js
 *   6. Replace math tokens with KaTeX-rendered HTML
 *
 * Why not markedKatex?
 *   The bundled marked-katex-extension has an overly restrictive regex for
 *   inline math: it requires '$' to be preceded by a space and followed by
 *   only specific punctuation.  This breaks $...$ inside parentheses
 *   (e.g. ($haha$)), with pipes ($|A|$), and in many list-item contexts.
 *   Our own pre/post-processing avoids these limitations entirely.
 *
 * Uses global libraries loaded via <script> tags in dashboard.html:
 *   - marked v11.2.0        → window.marked
 *   - KaTeX                 → window.katex  (standalone, for renderToString)
 *   - highlight.js v11.9.0  → window.hljs
 */

let _initialized = false;

// ── Math Extraction & Restoration ─────────────────────────────

/**
 * Extract LaTeX math from markdown text, replacing every occurrence
 * with a numbered token (@@REXOW_DM0@@, @@REXOW_IM1@@, etc.).
 * Code fences and inline code are temporarily protected so that dollar
 * signs inside code are never treated as math delimiters.
 *
 * @param {string} text - Raw markdown text
 * @returns {{ text: string, mathMap: Array<{token: string, latex: string, display: boolean}> }}
 */
export function extractMath(text) {
    const mathMap = [];
    let counter = 0;
    let result  = text;

    // ── Sanitize: strip any pre-existing REXOW tokens (from stale data) ──
    result = result.replace(/@@REXOW_(?:CF|IC|DM|IM)\d+@@/g, '');

    // ── Protect code fences ``` ... ``` ──
    const fences = [];
    result = result.replace(/(```[\s\S]*?```)/g, (m) => {
        fences.push(m);
        return `@@REXOW_CF${fences.length - 1}@@`;
    });

    // ── Protect inline code ` ... ` (single or double backtick) ──
    const codes = [];
    result = result.replace(/(``[^`]+``|`[^`\n]+`)/g, (m) => {
        codes.push(m);
        return `@@REXOW_IC${codes.length - 1}@@`;
    });

    // ── Extract display math $$...$$ (may span lines) ──
    result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
        let cleaned = latex.trim();
        // Normalize single \ at end of line → \\ for KaTeX row separators
        // in environments like pmatrix, bmatrix, cases, etc.
        // Only add \\ if the line ends with a single \ (not already \\).
        cleaned = cleaned.replace(/([^\\])\\([ \t]*)\n/g, '$1\\\\$2\n');
        const token = `@@REXOW_DM${counter}@@`;
        mathMap.push({ token, latex: cleaned, display: true });
        counter++;
        return token;
    });

    // ── Extract inline math $...$ ──
    // Matches $content$ where content has no newlines or unescaped $.
    result = result.replace(/\$([^\n$]+?)\$/g, (match, latex) => {
        const trimmed = latex.trim();
        if (!trimmed) return match;   // empty → leave as-is
        const token = `@@REXOW_IM${counter}@@`;
        mathMap.push({ token, latex: trimmed, display: false });
        counter++;
        return token;
    });

    // ── Restore code protections ──
    // Use split/join to avoid String.replace() which treats $ in the
    // replacement as special patterns ($`, $', $&), corrupting output.
    for (let i = codes.length - 1; i >= 0; i--) {
        result = result.split(`@@REXOW_IC${i}@@`).join(codes[i]);
    }
    for (let i = fences.length - 1; i >= 0; i--) {
        result = result.split(`@@REXOW_CF${i}@@`).join(fences[i]);
    }

    return { text: result, mathMap };
}

/**
 * Replace math tokens in rendered HTML with KaTeX-rendered formulas.
 *
 * @param {string} html      - HTML output from marked.parse()
 * @param {Array}  mathMap   - Array of {token, latex, display} objects
 * @returns {string} Final HTML with rendered math
 */
export function restoreMath(html, mathMap) {
    const _katex = window.katex;
    let result = html;

    for (const { token, latex, display } of mathMap) {
        let rendered;
        if (_katex) {
            try {
                rendered = _katex.renderToString(latex, {
                    throwOnError: false,
                    displayMode: display,
                });
            } catch {
                // Fallback: show raw LaTeX in a code element
                rendered = display
                    ? `<code>$$${latex}$$</code>`
                    : `<code>$${latex}$</code>`;
            }
        } else {
            // No KaTeX available — show raw delimiters
            rendered = display ? `$$${latex}$$` : `$${latex}$`;
        }
        // split/join avoids regex special-char issues in the token
        result = result.split(token).join(rendered);
    }

    // ── Final safety: strip any REXOW tokens that survived ──
    result = result.replace(/@@REXOW_(?:CF|IC|DM|IM)\d+@@/g, '');

    return result;
}

// ── Initialization ────────────────────────────────────────────

function ensureInit() {
    if (_initialized) return true;

    const _marked = window.marked;
    const _hljs   = window.hljs;

    if (!_marked || typeof _marked.parse !== 'function') {
        console.warn("[REXOW] marked library not loaded");
        return false;
    }

    try {
        // NOTE: We intentionally do NOT register markedKatex here.
        // Math rendering is handled by our own extractMath / restoreMath
        // pipeline which is far more robust (handles $...$ inside parens,
        // pipes, list items, adjacent text like $1$s, etc.).

        // Configure highlight.js for code syntax highlighting
        if (_hljs) {
            _marked.use({
                renderer: {
                    code(text, lang) {
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

// ── Public API ────────────────────────────────────────────────

/**
 * Parses raw markdown text into safe HTML, rendering LaTeX math blocks
 * and syntax-highlighted code blocks.
 *
 * Pipeline: extractMath → marked.parse → restoreMath
 *
 * @param {string} text - The raw markdown text
 * @returns {string} - The resulting HTML
 */
export function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    const ready  = ensureInit();
    const _marked = window.marked;

    // If marked didn't load, return escaped text
    if (!ready || !_marked || typeof _marked.parse !== 'function') {
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    try {
        // 1. Extract math → safe tokens
        const { text: withoutMath, mathMap } = extractMath(text);
        // 2. Parse markdown (math is safely tokenized, won't interfere)
        const html = _marked.parse(withoutMath);
        // 3. Restore math tokens → KaTeX rendered HTML
        return restoreMath(html, mathMap);
    } catch (e) {
        console.error("[REXOW] Markdown rendering error:", e);
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
