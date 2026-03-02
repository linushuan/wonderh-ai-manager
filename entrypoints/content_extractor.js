/**
 * content_extractor.js — REXOW Content Script
 * Injected into AI tabs. Routes to correct adapter via dynamic import.
 */
console.log("[REXOW] Content Extractor Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== "EXTRACT_CONTENT") return;

    (async () => {
        try {
            const data = await runAdapter();
            sendResponse({ status: "success", data });
        } catch (e) {
            console.error("[REXOW] Extraction error:", e);
            sendResponse({
                status: "error",
                msg: e.message || "Unknown extraction error.",
                detail: "The AI site layout may have changed. Please wait for a REXOW update."
            });
        }
    })();

    return true; // keep channel open for async sendResponse
});

async function runAdapter() {
    const url = window.location.href;

    // 1. Route to correct adapter
    let modulePath;
    if (url.includes("chatgpt.com"))        modulePath = "entrypoints/adapters/chatgpt.js";
    else if (url.includes("gemini.google.com")) modulePath = "entrypoints/adapters/gemini.js";
    else if (url.includes("claude.ai"))     modulePath = "entrypoints/adapters/claude.js";
    else throw new Error("Unsupported platform. REXOW works on ChatGPT, Gemini, and Claude.");

    // 2. Dynamically import adapter (must use chrome.runtime.getURL for web_accessible_resources)
    let AdapterClass;
    try {
        const src    = chrome.runtime.getURL(modulePath);
        const module = await import(src);
        AdapterClass = module.default;
    } catch (err) {
        throw new Error(`Failed to load adapter (${modulePath}): ${err.message}`);
    }

    if (typeof AdapterClass !== 'function') {
        throw new Error(`Adapter at ${modulePath} did not export a class.`);
    }

    // 3. Run adapter
    const adapter = new AdapterClass();
    console.log(`[REXOW] Running ${adapter.name} Adapter...`);

    let result;
    try {
        result = adapter.extract();
    } catch (err) {
        throw new Error(`${adapter.name} adapter crashed: ${err.message}`);
    }

    // 4. Validate result shape
    if (!result || typeof result !== 'object') {
        throw new Error(`${adapter.name} adapter returned invalid result.`);
    }
    if (!result.content || typeof result.content !== 'string' || !result.content.trim()) {
        throw new Error(`${adapter.name} adapter found no content. The page layout may have changed.`);
    }

    // 5. Normalise — ensure messages array always exists
    if (!Array.isArray(result.messages)) {
        result.messages = [];
    }

    return result;
}
