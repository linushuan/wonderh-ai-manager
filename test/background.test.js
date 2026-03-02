/**
 * tests/unit/background.test.js
 *
 * Tests service worker message routing.
 * Uses jest-chrome for Chrome API mocks.
 */

const mockPostMessage = jest.fn();
const mockConnectNative = jest.fn(() => ({
    postMessage: mockPostMessage,
    onMessage: { addListener: jest.fn() },
    onDisconnect: { addListener: jest.fn() }
}));
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
    mockPostMessage.mockClear();
    mockTabsQuery.mockClear();
    mockTabsSendMessage.mockClear();
    mockConnectNative.mockClear();
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
