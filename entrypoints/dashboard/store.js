/**
 * store.js — REXOW App State & Persistence
 *
 * 使用 long-lived port 與 background 通訊：
 * - initPort()：建立 port、監聽 DATA_LOADED、發送 LOAD_DATA
 * - sync()：仍走 one-shot sendMessage（SAVE_TO_DISK 不需要等回傳資料）
 */

let appData = { folders: [], chats: [] };
let currentSelectedId = null;
let expandedFolders = new Set();

// Long-lived port to background
let _port = null;
// Callback 在資料抵達時由 main.js 透過 onDataLoaded 設定
let _onDataLoaded = null;

// ─── Port 管理 ───────────────────────────────────────────────

/**
 * 建立與 background 的 long-lived port，並立刻發送 LOAD_DATA。
 * 當 background 回傳 DATA_LOADED 時，呼叫 _onDataLoaded callback。
 * @param {Function} onLoaded - (appData) => void
 */
export function initPort(onLoaded) {
    _onDataLoaded = onLoaded;

    function connect() {
        try {
            _port = chrome.runtime.connect({ name: "dashboard" });

            _port.onMessage.addListener((msg) => {
                if (msg.type === "DATA_LOADED") {
                    if (!msg.payload) {
                        console.warn("[REXOW STORE] DATA_LOADED: empty payload");
                        return;
                    }
                    setAppData(msg.payload);
                    if (_onDataLoaded) _onDataLoaded(appData);
                } else if (msg.type === "LOAD_ERROR") {
                    console.error("[REXOW STORE] LOAD_ERROR:", msg.msg);
                }
            });

            _port.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                console.warn("[REXOW STORE] port disconnected, reconnecting in 1s...");
                _port = null;
                // 重新連線（service worker 可能重啟了）
                setTimeout(connect, 1000);
            });

            // Port 建立後立刻請求資料
            _port.postMessage({ type: "LOAD_DATA" });

        } catch (e) {
            console.error("[REXOW STORE] connect failed:", e.message);
            setTimeout(connect, 1000);
        }
    }

    connect();
}

// ─── Getters ────────────────────────────────────────────────

export function getAppData()        { return appData; }
export function getCurrentId()      { return currentSelectedId; }
export function getExpandedFolders(){ return expandedFolders; }

// ─── Setters ────────────────────────────────────────────────

export function setAppData(data) {
    if (!data || typeof data !== 'object') {
        console.error("[REXOW STORE] setAppData: invalid", data);
        return;
    }
    appData = data;
    if (!Array.isArray(appData.folders)) appData.folders = [];
    if (!Array.isArray(appData.chats))   appData.chats   = [];
}

export function setCurrentId(id) { currentSelectedId = id; }

// ─── Folder CRUD ────────────────────────────────────────────

export function addFolder(name, parentId) {
    if (!name?.trim()) throw new Error("Folder name cannot be empty.");
    const folder = { id: crypto.randomUUID(), name: name.trim(), parentId: parentId ?? null, notes: "" };
    appData.folders.push(folder);
    sync();
    return folder;
}

export function updateFolder(id, patch) {
    if (!id) return;
    const folder = appData.folders.find(f => f.id === id);
    if (!folder) { console.warn("[REXOW STORE] updateFolder: not found", id); return; }
    Object.assign(folder, patch);
    sync();
}

export function deleteFolder(id) {
    if (!id) return;
    const toDelete = new Set([id]);
    let frontier = [id];
    while (frontier.length > 0) {
        const next = [];
        for (const pid of frontier)
            appData.folders.filter(f => f.parentId === pid)
            .forEach(f => { toDelete.add(f.id); next.push(f.id); });
        frontier = next;
    }
    appData.folders = appData.folders.filter(f => !toDelete.has(f.id));
    appData.chats   = appData.chats.filter(c => !toDelete.has(c.parentId));
    sync();
}

// ─── Chat CRUD ──────────────────────────────────────────────

export function addChat(name, parentId) {
    if (!name?.trim()) throw new Error("Chat name cannot be empty.");
    if (!parentId)     throw new Error("Chat must belong to a folder.");
    const chat = {
        id: crypto.randomUUID(), name: name.trim(), parentId,
        url: "", platform: null, notes: "", summary: "", content: "", messages: []
    };
    appData.chats.push(chat);
    sync();
    return chat;
}

export function updateChat(id, patch) {
    if (!id) return;
    const chat = appData.chats.find(c => c.id === id);
    if (!chat) { console.warn("[REXOW STORE] updateChat: not found", id); return; }
    Object.assign(chat, patch);
    sync();
}

export function deleteChat(id) {
    if (!id) return;
    appData.chats = appData.chats.filter(c => c.id !== id);
    sync();
}

// ─── Persistence ────────────────────────────────────────────

export function sync() {
    try {
        chrome.runtime.sendMessage({ type: "SAVE_TO_DISK", payload: appData }, (res) => {
            void chrome.runtime.lastError; // suppress unchecked error warning
        });
    } catch (e) {
        console.error("[REXOW STORE] sync threw:", e);
    }
}
