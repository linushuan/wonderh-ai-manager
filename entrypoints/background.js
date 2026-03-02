/**
 * background.js — REXOW Service Worker
 *
 * Firefox 相容性說明：
 * Firefox extension page 無法透過 chrome.runtime.sendMessage 廣播
 * 收到來自 background 的訊息。必須用 long-lived port (runtime.connect)。
 *
 * 資料載入流程：
 * 1. dashboard 連線時建立 port (runtime.connect)
 * 2. dashboard 透過 port.postMessage({ type: "LOAD_DATA" }) 請求資料
 * 3. background 收到後向 native host 發出 load
 * 4. native host 回應後，background 透過同一個 port 回傳 DATA_LOADED
 * 5. dashboard port.onMessage 收到資料 → setAppData + renderTree
 *
 * SAVE_TO_DISK 與 TRIGGER_EXTRACT 仍走 chrome.runtime.sendMessage（one-shot 即可）
 */

const HOST_NAME = "com.wonderh.ai.manager";
let nativePort = null;

// 儲存所有已連線的 dashboard ports
const dashboardPorts = new Set();

function connectNative() {
    if (nativePort) return; // 已連線，不重複建立
    try {
        nativePort = chrome.runtime.connectNative(HOST_NAME);

        nativePort.onMessage.addListener((res) => {
            if (!res || typeof res !== 'object') return;
            if (res.status === "ok" && res.data !== undefined) {
                // 把資料推送給所有已連線的 dashboard port
                const msg = { type: "DATA_LOADED", payload: res.data };
                dashboardPorts.forEach(p => {
                    try { p.postMessage(msg); } catch (_) { dashboardPorts.delete(p); }
                });
            }
        });

        nativePort.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            nativePort = null;
        });

    } catch (e) {
        console.error("[REXOW BG] connectNative failed:", e.message);
        nativePort = null;
    }
}

// Service worker 啟動時立刻連線
connectNative();

// ── Dashboard long-lived port 管理 ──────────────────────────
// dashboard/main.js 用 chrome.runtime.connect({ name: "dashboard" }) 建立連線
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "dashboard") return;

    dashboardPorts.add(port);

    port.onMessage.addListener((req) => {
        if (!nativePort) connectNative();

        if (req.type === "LOAD_DATA") {
            if (!nativePort) {
                port.postMessage({ type: "LOAD_ERROR", msg: "Native host not connected." });
                return;
            }
            try {
                nativePort.postMessage({ action: "load" });
            } catch (e) {
                port.postMessage({ type: "LOAD_ERROR", msg: e.message });
            }
        }
    });

    port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        dashboardPorts.delete(port);
    });
});

// ── One-shot messages (SAVE & EXTRACT) ──────────────────────
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (!nativePort) connectNative();

    if (req.type === "SAVE_TO_DISK") {
        if (!nativePort) {
            sendResponse({ status: "error", msg: "Native host not connected." });
            return;
        }
        try {
            nativePort.postMessage({ action: "save", data: req.payload });
            sendResponse({ status: "ok" });
        } catch (e) {
            sendResponse({ status: "error", msg: e.message });
        }

    } else if (req.type === "TRIGGER_EXTRACT") {
        if (!req.url || typeof req.url !== 'string') {
            sendResponse({ status: "error", msg: "Invalid URL provided." });
            return true;
        }
        chrome.tabs.query({}, (tabs) => {
            void chrome.runtime.lastError;
            const target = tabs.find(t => t.url && t.url.startsWith(req.url));
            if (!target) {
                sendResponse({ status: "error", msg: "No matching tab found", detail: `Open "${req.url}" in a tab first.` });
                return;
            }
            chrome.tabs.sendMessage(target.id, { type: "EXTRACT_CONTENT" }, (res) => {
                const err = chrome.runtime.lastError;
                if (err) { sendResponse({ status: "error", msg: err.message, detail: "Try refreshing the AI tab." }); return; }
                if (!res) { sendResponse({ status: "error", msg: "No response from content script." }); return; }
                sendResponse(res);
            });
        });
        return true;

    } else if (req.type === "SEND_MESSAGE") {
        if (!req.url || typeof req.url !== 'string') {
            sendResponse({ status: "error", msg: "Invalid URL provided." });
            return true;
        }
        if (!req.text || typeof req.text !== 'string') {
            sendResponse({ status: "error", msg: "No message text provided." });
            return true;
        }
        chrome.tabs.query({}, (tabs) => {
            void chrome.runtime.lastError;
            const target = tabs.find(t => t.url && t.url.startsWith(req.url));
            if (!target) {
                sendResponse({ status: "error", msg: "No matching tab found", detail: `Open "${req.url}" in a tab first.` });
                return;
            }
            chrome.tabs.sendMessage(target.id, { type: "SEND_MESSAGE", text: req.text }, (res) => {
                const err = chrome.runtime.lastError;
                if (err) { sendResponse({ status: "error", msg: err.message, detail: "Try refreshing the AI tab." }); return; }
                if (!res) { sendResponse({ status: "error", msg: "No response from content script." }); return; }
                sendResponse(res);
            });
        });
        return true;
    }
});

chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("entrypoints/dashboard.html") });
});
