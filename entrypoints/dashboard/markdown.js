/**
 * markdown.js — Markdown + LaTeX Rendering
 *
 * Uses the global `marked` and `markedKatex` objects loaded via
 * <script> tags in dashboard.html (UMD builds).
 *
 * marked v11.2.0 + marked-katex-extension v4.0.5 (bundles katex internally)
 */

let _initialized = false;

function ensureInit() {
    if (_initialized) return true;

    // Access globals via window — ES modules have their own scope
    const _marked = window.marked;
    const _markedKatex = window.markedKatex;

    if (!_marked || typeof _marked.parse !== 'function') {
        console.warn("[REXOW] marked library not loaded");
        return false;
    }

    try {
        // Configure KaTeX extension for LaTeX rendering
        if (typeof _markedKatex === 'function') {
            _marked.use(_markedKatex({
                throwOnError: false
                // v4.0.5 does not have 'nonStandard' option
                // It supports $...$ (inline) and $$...$$ (block) by default
            }));
            console.log("[REXOW] Markdown + KaTeX initialized");
        } else {
            console.warn("[REXOW] markedKatex not loaded, LaTeX won't render");
        }

        _initialized = true;
        return true;
    } catch (e) {
        console.error("[REXOW] Markdown init error:", e);
        return false;
    }
}

/**
 * Parses raw markdown text into safe HTML, rendering LaTeX math blocks.
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
