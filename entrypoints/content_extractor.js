/**
 * content_extractor.js — REXOW Content Script
 * Injected into AI tabs. Routes to correct adapter via dynamic import.
 */
console.log("[REXOW] Content Extractor Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Inject a floating "Back to REXOW" button for easy navigation
    function injectRexowButton() {
        if (document.getElementById('rexow-float-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'rexow-float-btn';
        btn.innerText = 'Back to REXOW';
        Object.assign(btn.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: 999999,
            backgroundColor: '#4f46e5', color: '#fff', border: 'none',
            borderRadius: '8px', padding: '10px 16px', cursor: 'pointer',
            fontWeight: 'bold', fontFamily: 'sans-serif', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        });
        btn.onclick = () => chrome.runtime.sendMessage({ type: "SWITCH_TO_REXOW" });
        document.body.appendChild(btn);
    }

    if (request.type === "EXTRACT_CONTENT") {
        injectRexowButton();
        runAdapter().then(result => {
            sendResponse({ status: "success", data: result });
        }).catch(err => {
            console.error("[REXOW] Extraction error:", err);
            sendResponse({ status: "error", msg: err.message || "Failed to extract content" });
        });
        return true;
    }

    if (request.type === "SEND_MESSAGE") {
        injectRexowButton();
        (async () => {
            try {
                const adapter = await getAdapter();
                if (typeof adapter.sendMessage !== 'function') {
                    sendResponse({ status: "error", msg: "This adapter does not support sending messages." });
                    return;
                }

                // 1. Send the message
                adapter.sendMessage(request.text);

                // 2. Wait for AI to finish responding (uses MutationObserver)
                if (typeof adapter.waitForResponse === 'function') {
                    console.log('[REXOW] Waiting for AI response...');
                    await adapter.waitForResponse();
                    console.log('[REXOW] AI response detected, extracting...');
                } else {
                    // Fallback: simple delay for adapters without waitForResponse
                    await new Promise(r => setTimeout(r, 5000));
                }

                // 3. Scroll to bottom to ensure latest content is rendered
                if (typeof adapter.prepareForExtract === 'function') {
                    adapter.prepareForExtract();
                    await new Promise(r => setTimeout(r, 500));
                }

                // 4. Extract updated content
                let result;
                try {
                    result = adapter.extract();
                } catch (err) {
                    // Extraction failed but message was sent
                    sendResponse({ status: "success", sent: true, data: null });
                    return;
                }

                if (!Array.isArray(result.messages)) result.messages = [];

                sendResponse({ status: "success", sent: true, data: result });
            } catch (e) {
                console.error("[REXOW] Send message error:", e);
                sendResponse({
                    status: "error",
                    msg: e.message || "Failed to send message.",
                    detail: "The AI site input may have changed."
                });
            }
        })();
        return true;
    }
});

async function getAdapter() {
    const url = window.location.href;

    // Route to correct adapter
    let modulePath;
    if (url.includes("chatgpt.com")) modulePath = "entrypoints/adapters/chatgpt.js";
    else if (url.includes("gemini.google.com")) modulePath = "entrypoints/adapters/gemini.js";
    else if (url.includes("claude.ai")) modulePath = "entrypoints/adapters/claude.js";
    else throw new Error("Unsupported platform. REXOW works on ChatGPT, Gemini, and Claude.");

    // Dynamically import adapter (must use chrome.runtime.getURL for web_accessible_resources)
    let AdapterClass;
    try {
        const src = chrome.runtime.getURL(modulePath);
        const module = await import(src);
        AdapterClass = module.default;
    } catch (err) {
        throw new Error(`Failed to load adapter (${modulePath}): ${err.message}`);
    }

    if (typeof AdapterClass !== 'function') {
        throw new Error(`Adapter at ${modulePath} did not export a class.`);
    }

    const adapter = new AdapterClass();
    console.log(`[REXOW] Using ${adapter.name} Adapter`);
    return adapter;
}

async function runAdapter() {
    const adapter = await getAdapter();

    // Prepare the page for extraction (e.g., scroll to bottom to render latest messages)
    if (typeof adapter.prepareForExtract === 'function') {
        adapter.prepareForExtract();
        // Small wait for the DOM to update after scrolling
        await new Promise(r => setTimeout(r, 500));
    }

    let result;
    try {
        result = adapter.extract();
    } catch (err) {
        throw new Error(`${adapter.name} adapter crashed: ${err.message}`);
    }

    // Validate result shape
    if (!result || typeof result !== 'object') {
        throw new Error(`${adapter.name} adapter returned invalid result.`);
    }
    if (!result.content || typeof result.content !== 'string' || !result.content.trim()) {
        throw new Error(`${adapter.name} adapter found no content. The page layout may have changed.`);
    }

    // Normalise — ensure messages array always exists
    if (!Array.isArray(result.messages)) {
        result.messages = [];
    }

    return result;
}
