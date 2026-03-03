/**
 * content_extractor.js — REXOW Content Script
 * Injected into AI tabs. Routes to correct adapter via dynamic import.
 */
console.log("[REXOW] Content Extractor Loaded");

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

// Ensure the button is present when the page first loads
injectRexowButton();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.type === "EXTRACT_CONTENT") {
        injectRexowButton();
        runAdapter(request.url || window.location.href).then(result => {
            sendResponse({ status: "success", data: result });
        }).catch(err => {
            console.error("[REXOW] Extraction error:", err);
            sendResponse({ status: "error", msg: err.message || "Failed to extract content" });
        });
        return true;
    }

    if (request.type === "SEND_MESSAGE" || request.type === "SEND_ONLY") {
        injectRexowButton();
        (async () => {
            try {
                const adapter = await getAdapter(request.url || window.location.href);
                if (typeof adapter.sendMessage !== 'function') {
                    sendResponse({ status: "error", msg: "This adapter does not support sending messages." });
                    return;
                }

                // Send the message
                adapter.sendMessage(request.text);

                // SEND_ONLY: return immediately after sending (dashboard will poll)
                if (request.type === "SEND_ONLY") {
                    sendResponse({ status: "success", sent: true });
                    return;
                }

                // SEND_MESSAGE (legacy): wait for response and extract
                if (typeof adapter.waitForResponse === 'function') {
                    console.log('[REXOW] Waiting for AI response...');
                    await adapter.waitForResponse();
                    console.log('[REXOW] AI response detected, extracting...');
                } else {
                    await new Promise(r => setTimeout(r, 5000));
                }

                if (typeof adapter.prepareForExtract === 'function') {
                    adapter.prepareForExtract();
                    await new Promise(r => setTimeout(r, 500));
                }

                let result;
                try {
                    result = adapter.extract();
                } catch (err) {
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

    if (request.type === "WAIT_AND_EXTRACT") {
        injectRexowButton();
        (async () => {
            try {
                const adapter = await getAdapter(request.url || window.location.href);

                // Wait for AI response to finish
                if (typeof adapter.waitForResponse === 'function') {
                    console.log('[REXOW] WAIT_AND_EXTRACT: waiting for AI response...');
                    await adapter.waitForResponse();
                    console.log('[REXOW] WAIT_AND_EXTRACT: AI response detected');
                } else {
                    // Fallback: wait a fixed amount of time
                    await new Promise(r => setTimeout(r, 5000));
                }

                // Prepare and extract
                if (typeof adapter.prepareForExtract === 'function') {
                    adapter.prepareForExtract();
                    await new Promise(r => setTimeout(r, 500));
                }

                let result;
                try {
                    result = adapter.extract();
                } catch (err) {
                    sendResponse({ status: "error", msg: "Extraction failed: " + err.message });
                    return;
                }

                if (!Array.isArray(result.messages)) result.messages = [];
                sendResponse({ status: "success", data: result });
            } catch (e) {
                console.error("[REXOW] WAIT_AND_EXTRACT error:", e);
                sendResponse({
                    status: "error",
                    msg: e.message || "Failed to wait and extract.",
                    detail: "The AI site may have changed."
                });
            }
        })();
        return true;
    }

    if (request.type === "REXOW_CLOSED") {
        const btn = document.getElementById('rexow-float-btn');
        if (btn) {
            btn.remove();
            console.log('[REXOW] Dashboard closed — removed float button');
        }
    }
});

async function getAdapter(url) {

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

async function runAdapter(url) {
    const adapter = await getAdapter(url);

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
