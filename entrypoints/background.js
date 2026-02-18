const HOST_NAME = "com.wonderh.ai.manager";
let nativePort = null;

function connectNative() {
    try {
        nativePort = chrome.runtime.connectNative(HOST_NAME);
        nativePort.onMessage.addListener((res) => {
            chrome.runtime.sendMessage({ type: "DATA_LOADED", payload: res.data });
        });
        nativePort.onDisconnect.addListener(() => { nativePort = null; });
    } catch (e) { console.error(e); }
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (!nativePort) connectNative();
    if (req.type === "SAVE_TO_DISK") {
        nativePort.postMessage({ action: "save", data: req.payload });
        sendResponse({ status: "ok" });
    } else if (req.type === "LOAD_DATA") {
        nativePort.postMessage({ action: "load" });
        sendResponse({ status: "ok" });
    }
    return true;
});

chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("entrypoints/dashboard.html") });
});
