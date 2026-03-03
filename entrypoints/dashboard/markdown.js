/**
 * markdown.js — Markdown + LaTeX Rendering
 *
 * Uses the global `marked` and `markedKatex` objects loaded via
 * <script> tags in dashboard.html (UMD builds).
 *
 * marked v11.2.0 + marked-katex-extension v4.0.5 + katex v0.16.8
 */

let _initialized = false;

function ensureInit() {
    if (_initialized) return;

    // marked UMD exports: window.marked = { marked, Marked, ... }
    if (typeof marked === 'undefined') {
        console.warn("[REXOW] marked library not loaded yet");
        return;
    }

    try {
        // The UMD build exposes `marked` as a namespace with `marked.marked` being the parse fn.
        // But also `marked.use(...)` is available at the top level.

        // Configure KaTeX extension if available
        if (typeof markedKatex !== 'undefined') {
            marked.use(markedKatex({
                throwOnError: false,
                nonStandard: true  // Support \( \) and \[ \] delimiters
            }));
        } else {
            console.warn("[REXOW] markedKatex not loaded");
        }

        _initialized = true;
        console.log("[REXOW] Markdown + KaTeX initialized");
    } catch (e) {
        console.error("[REXOW] Markdown init error:", e);
    }
}

/**
 * Parses raw markdown text into safe HTML, rendering LaTeX math blocks.
 * @param {string} text - The raw markdown text  
 * @returns {string} - The resulting HTML
 */
export function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    ensureInit();

    // If marked didn't load, return escaped text
    if (typeof marked === 'undefined' || !_initialized) {
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    try {
        // marked.parse() is the main entry point in v11 UMD
        const result = marked.parse(text);
        return result;
    } catch (e) {
        console.error("[REXOW] Markdown rendering error:", e);
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
