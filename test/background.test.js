/**
 * tests/unit/background.test.js
 *
 * Tests service worker message routing.
 * Uses jest-chrome for Chrome API mocks.
 */

let nativeListeners = [];
const mockPostMessage = jest.fn();
const stableNativePort = {
    postMessage: mockPostMessage,
    onMessage: { addListener: jest.fn(fn => nativeListeners.push(fn)) },
    onDisconnect: { addListener: jest.fn() }
};
const mockConnectNative = jest.fn(() => stableNativePort);
const mockTabsQuery = jest.fn();
const mockTabsSendMessage = jest.fn();

global.chrome = {
    runtime: {
        connectNative: mockConnectNative,
        sendMessage: jest.fn(),
        onConnect: { addListener: jest.fn() },
        lastError: null,
        getURL: (p) => `chrome-extension://testid/${p}`
    },
    tabs: {
        query: mockTabsQuery,
        sendMessage: mockTabsSendMessage,
        create: jest.fn()
    },
    action: { onClicked: { addListener: jest.fn() } }
};

// ── Helper: simulate receiving a message ────────────────────
function fireMessage(req, sendResponse = jest.fn()) {
    const listener = chrome.runtime.onMessage._listeners?.[0];
    if (listener) return listener(req, {}, sendResponse);
}

let messageListeners = [];
global.chrome.runtime.onMessage = {
    addListener: (fn) => messageListeners.push(fn),
    _fire: (req, sender, cb) => messageListeners.forEach(l => l(req, sender, cb))
};

beforeEach(() => {
    jest.resetModules();
    messageListeners = [];
    nativeListeners = [];
    mockPostMessage.mockClear();
    mockTabsQuery.mockClear();
    mockTabsSendMessage.mockClear();
    mockConnectNative.mockClear();
    stableNativePort.onMessage.addListener.mockClear();
    global.chrome.runtime.onConnect.addListener.mockClear();
    require('../entrypoints/background.js');
});

// ── SAVE_TO_DISK ─────────────────────────────────────────────

test('SAVE_TO_DISK posts correct message to native port', () => {
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "SAVE_TO_DISK", payload: { folders: [], chats: [] } },
        {},
        sendResponse
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: "save" })
    );
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
});

// ── LOAD_DATA (onConnect) ────────────────────────────────────

test('onConnect creates dashboard port and handles LOAD_DATA', () => {
    let messageListener;
    const mockPort = {
        name: "dashboard",
        onMessage: { addListener: jest.fn(fn => messageListener = fn) },
        onDisconnect: { addListener: jest.fn() },
        postMessage: jest.fn()
    };

    const connectListener = global.chrome.runtime.onConnect.addListener.mock.calls[0][0];
    connectListener(mockPort);

    // Call LOAD_DATA
    messageListener({ type: "LOAD_DATA" });

    expect(mockPostMessage).toHaveBeenCalledWith({ action: "load" });

    // Simulate Native Response via stable nativeListeners array
    nativeListeners.forEach(fn => fn({ status: "ok", data: { text: "mock" } }));

    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: "DATA_LOADED", payload: { text: "mock" } });
});

// ── TRIGGER_EXTRACT: success ─────────────────────────────────

test('TRIGGER_EXTRACT finds matching tab and sends EXTRACT_CONTENT', () => {
    const targetTab = { id: 42, url: "https://chatgpt.com/c/abc123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) =>
        cb({ status: "success", data: { title: "T", content: "C", messages: [] } })
    );

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "TRIGGER_EXTRACT", url: "https://chatgpt.com/c/abc123" },
        {},
        sendResponse
    );

    expect(mockTabsSendMessage).toHaveBeenCalledWith(
        42,
        { type: "EXTRACT_CONTENT" },
        expect.any(Function)
    );
    expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success" })
    );
});

// ── TRIGGER_EXTRACT: no tab found ────────────────────────────

test('TRIGGER_EXTRACT returns error if no matching tab', () => {
    mockTabsQuery.mockImplementation((_, cb) => cb([]));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "TRIGGER_EXTRACT", url: "https://chatgpt.com/c/nope" },
        {},
        sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error", msg: "No matching tab found" })
    );
});

// ── TRIGGER_EXTRACT: partial URL match ───────────────────────

test('TRIGGER_EXTRACT matches tab with URL prefix', () => {
    const targetTab = { id: 7, url: "https://chatgpt.com/c/abc?param=1" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    mockTabsSendMessage.mockImplementation((_, __, cb) => cb({ status: "success", data: {} }));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "TRIGGER_EXTRACT", url: "https://chatgpt.com/c/abc" },
        {},
        sendResponse
    );

    expect(mockTabsSendMessage).toHaveBeenCalledWith(7, expect.anything(), expect.any(Function));
});

// ── SEND_MESSAGE ─────────────────────────────────────────────

test('SEND_MESSAGE finds matching tab and forwards message to content script', () => {
    const targetTab = { id: 10, url: "https://gemini.google.com/app/abc123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) =>
        cb({ status: "success" })
    );

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "SEND_MESSAGE", url: "https://gemini.google.com/app/abc123", text: "Hello AI" },
        {},
        sendResponse
    );

    expect(mockTabsSendMessage).toHaveBeenCalledWith(
        10,
        { type: "SEND_MESSAGE", text: "Hello AI" },
        expect.any(Function)
    );
    expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success" })
    );
});

test('SEND_MESSAGE returns error when text is missing', () => {
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "SEND_MESSAGE", url: "https://gemini.google.com/app/abc123" },
        {},
        sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error", msg: "No message text provided." })
    );
});

// ── SEND_ONLY ────────────────────────────────────────────────

test('SEND_ONLY forwards message and returns immediately', () => {
    const targetTab = { id: 11, url: "https://chatgpt.com/c/123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) => cb({ status: "success", sent: true }));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire(
        { type: "SEND_ONLY", url: "https://chatgpt.com/c/123", text: "Test info" },
        {},
        sendResponse
    );

    expect(mockTabsSendMessage).toHaveBeenCalledWith(11, { type: "SEND_ONLY", text: "Test info" }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
});

test('SEND_ONLY returns error when url or text missing', () => {
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "SEND_ONLY", url: "https://chatgpt.com" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "error", msg: "Missing url or text." }));
});

// ── SWITCH_TO_REXOW & SWITCH_TO_AI_TAB ───────────────────────

test('SWITCH_TO_REXOW finds dashboard tab and activates it', () => {
    const targetTab = { id: 99, windowId: 5, url: "chrome-extension://testid/entrypoints/dashboard.html" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    global.chrome.tabs.update = jest.fn();
    global.chrome.windows = { update: jest.fn() };

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "SWITCH_TO_REXOW" }, {}, sendResponse);

    expect(global.chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    expect(global.chrome.windows.update).toHaveBeenCalledWith(5, { focused: true });
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
});

test('SWITCH_TO_AI_TAB finds target tab and activates it', () => {
    const targetTab = { id: 12, windowId: 6, url: "https://claude.ai/chat/123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    global.chrome.tabs.update = jest.fn();
    global.chrome.windows = { update: jest.fn() };

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "SWITCH_TO_AI_TAB", url: "https://claude.ai/chat/123" }, {}, sendResponse);

    expect(global.chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(global.chrome.windows.update).toHaveBeenCalledWith(6, { focused: true });
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
});

// ── WAIT_AND_EXTRACT ───────────────────────────────────────

test('WAIT_AND_EXTRACT returns error if no url', () => {
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "WAIT_AND_EXTRACT" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "error", msg: "No URL provided." }));
});

test('WAIT_AND_EXTRACT returns error if no matching tab', () => {
    mockTabsQuery.mockImplementation((_, cb) => cb([]));
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "WAIT_AND_EXTRACT", url: "https://notfound.com" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "error", msg: "No matching tab found" }));
});

test('WAIT_AND_EXTRACT forwards request to content script and returns response', () => {
    const targetTab = { id: 45, url: "https://gemini.google.com/app/123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) => cb({ status: "success", data: "test" }));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "WAIT_AND_EXTRACT", url: "https://gemini.google.com/app/123" }, {}, sendResponse);

    expect(mockTabsSendMessage).toHaveBeenCalledWith(45, { type: "WAIT_AND_EXTRACT" }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({ status: "success", data: "test" });
});

test('WAIT_AND_EXTRACT handles lastError during sendMessage', () => {
    const targetTab = { id: 45, url: "https://gemini.google.com/app/123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "WAIT_AND_EXTRACT", url: "https://gemini.google.com/app/123" }, {}, sendResponse);

    // Mock an error
    const sendMessageCallback = mockTabsSendMessage.mock.calls[0][2];
    global.chrome.runtime.lastError = new Error("Injection failed");
    sendMessageCallback(null);
    delete global.chrome.runtime.lastError;

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "error", msg: "Injection failed" }));
});

test('WAIT_AND_EXTRACT handles empty response during sendMessage', () => {
    const targetTab = { id: 45, url: "https://gemini.google.com/app/123" };
    mockTabsQuery.mockImplementation((_, cb) => cb([targetTab]));

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: "WAIT_AND_EXTRACT", url: "https://gemini.google.com/app/123" }, {}, sendResponse);

    const sendMessageCallback = mockTabsSendMessage.mock.calls[0][2];
    sendMessageCallback(null); // null response

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: "error", msg: "No response from content script." }));
});

// ── IS_REXOW_OPEN ──────────────────────────────────────────

test('IS_REXOW_OPEN returns false when no dashboard port is connected', () => {
    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: 'IS_REXOW_OPEN' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ status: 'ok', open: false });
});

test('IS_REXOW_OPEN returns true when dashboard port is connected', () => {
    const mockPort = {
        name: 'dashboard',
        onMessage: { addListener: jest.fn() },
        onDisconnect: { addListener: jest.fn() },
        postMessage: jest.fn()
    };
    const connectListener = global.chrome.runtime.onConnect.addListener.mock.calls[0][0];
    connectListener(mockPort);

    const sendResponse = jest.fn();
    global.chrome.runtime.onMessage._fire({ type: 'IS_REXOW_OPEN' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ status: 'ok', open: true });
});

// ── Dashboard first connect → REXOW_OPENED broadcast ──────

test('broadcasts REXOW_OPENED to all tabs when first dashboard port connects', () => {
    mockTabsQuery.mockImplementation((_, cb) => cb([
        { id: 1, url: 'https://gemini.google.com/app/123' },
        { id: 2, url: 'https://chatgpt.com/c/456' }
    ]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) => { if (cb) cb(); });

    const mockPort = {
        name: 'dashboard',
        onMessage: { addListener: jest.fn() },
        onDisconnect: { addListener: jest.fn() },
        postMessage: jest.fn()
    };

    const connectListener = global.chrome.runtime.onConnect.addListener.mock.calls[0][0];
    connectListener(mockPort);

    expect(mockTabsQuery).toHaveBeenCalled();
    expect(mockTabsSendMessage).toHaveBeenCalledWith(1, { type: 'REXOW_OPENED' }, expect.any(Function));
    expect(mockTabsSendMessage).toHaveBeenCalledWith(2, { type: 'REXOW_OPENED' }, expect.any(Function));
});

// ── Dashboard port disconnect → REXOW_CLOSED broadcast ──────

test('broadcasts REXOW_CLOSED to all tabs when last dashboard port disconnects', () => {
    let disconnectListener;
    const mockPort = {
        name: "dashboard",
        onMessage: { addListener: jest.fn() },
        onDisconnect: { addListener: jest.fn(fn => disconnectListener = fn) },
        postMessage: jest.fn()
    };

    const connectListener = global.chrome.runtime.onConnect.addListener.mock.calls[0][0];
    connectListener(mockPort);

    // Set up tabs.query and tabs.sendMessage mocks
    global.chrome.tabs.update = jest.fn();
    mockTabsQuery.mockImplementation((_, cb) => cb([
        { id: 1, url: "https://gemini.google.com/app/123" },
        { id: 2, url: "https://chatgpt.com/c/456" }
    ]));
    mockTabsSendMessage.mockImplementation((tabId, msg, cb) => { if (cb) cb(); });

    // Simulate port disconnect
    disconnectListener();

    // Should have queried all tabs and sent REXOW_CLOSED to each
    expect(mockTabsQuery).toHaveBeenCalled();
    expect(mockTabsSendMessage).toHaveBeenCalledWith(1, { type: "REXOW_CLOSED" }, expect.any(Function));
    expect(mockTabsSendMessage).toHaveBeenCalledWith(2, { type: "REXOW_CLOSED" }, expect.any(Function));
});

// ── Action ───────────────────────────────────────────────────

test('action.onClicked creates dashboard tab', () => {
    const listener = global.chrome.action.onClicked.addListener.mock.calls[0][0];
    listener();
    expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://testid/entrypoints/dashboard.html" });
});
