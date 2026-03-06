/**
 * content_extractor.test.js — Tests for the content extractor routing logic
 */

// Mock chrome APIs
global.chrome = {
    runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
        getURL: jest.fn((path) => `chrome-extension://test-id/${path}`)
    }
};

// Mock adapter instances to inject into tests
let mockActiveAdapter = null;

jest.mock('../entrypoints/adapters/chatgpt.js', () => {
    return class MockAdapter { constructor() { Object.assign(this, mockActiveAdapter); this.name = this.name || "ChatGPT"; } };
});
jest.mock('../entrypoints/adapters/gemini.js', () => {
    return class MockAdapter { constructor() { Object.assign(this, mockActiveAdapter); this.name = this.name || "Gemini"; } };
});
jest.mock('../entrypoints/adapters/claude.js', () => {
    return class MockAdapter { constructor() { Object.assign(this, mockActiveAdapter); this.name = this.name || "Claude"; } };
});


// Helper to reliably set the URL in JSDOM environments without throwing security errors.
// Shadows the readonly window.location property using a Proxy.
function setTestUrl(url) {
    if (!global._originalWindow) global._originalWindow = global.window;
    global.window = new Proxy(global._originalWindow, {
        get: function (target, prop) {
            if (prop === 'location') return { href: url };
            let value = target[prop];
            // Bind functions to the original window so they execute correctly (e.g., setTimeout)
            if (typeof value === 'function') return value.bind(target);
            return value;
        }
    });
}

describe('content_extractor', () => {
    let messageHandler;

    beforeEach(() => {
        document.body.innerHTML = '';
        chrome.runtime.onMessage.addListener.mockClear();
        chrome.runtime.sendMessage.mockClear();
        chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
            if (msg?.type === 'IS_REXOW_OPEN') cb?.({ status: 'ok', open: false });
            else cb?.({ status: 'ok' });
        });
        // Return a relative path so Jest's dynamic import properly routes to the mocks!
        chrome.runtime.getURL.mockImplementation((path) => `../${path}`);
        mockActiveAdapter = null;

        // Require the module, which registers the listener
        jest.resetModules();
        require('../entrypoints/content_extractor.js');

        // Get the registered message handler
        messageHandler = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    });

    test('does not inject "Back to REXOW" button on load when dashboard is closed', () => {
        const btn = document.getElementById('rexow-float-btn');
        expect(btn).toBeNull();
    });

    test('does not duplicate button on re-injection', () => {
        const listener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
        listener({ type: 'REXOW_OPENED' }, {}, jest.fn());

        const existingBtn = document.getElementById('rexow-float-btn');
        expect(existingBtn).not.toBeNull();

        // Try to re-inject
        listener({ type: 'REXOW_OPENED' }, {}, jest.fn());
        const buttons = document.querySelectorAll('#rexow-float-btn');
        expect(buttons.length).toBe(1);
    });

    test('injects button when REXOW_OPENED is received', () => {
        const btnBefore = document.getElementById('rexow-float-btn');
        expect(btnBefore).toBeNull();

        const sendResponse = jest.fn();
        messageHandler({ type: 'REXOW_OPENED' }, {}, sendResponse);

        const btnAfter = document.getElementById('rexow-float-btn');
        expect(btnAfter).not.toBeNull();
        expect(btnAfter.innerText).toBe('Back to REXOW');
    });

    test('EXTRACT_CONTENT returns true for async', () => {
        const sendResponse = jest.fn();
        const result = messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://chatgpt.com' }, {}, sendResponse);
        expect(result).toBe(true);
    });

    test('EXTRACT_CONTENT fails on invalid URL platform', async () => {
        const sendResponse = jest.fn();
        messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://example.com' }, {}, sendResponse);

        // Wait for async execution
        await new Promise(r => setTimeout(r, 50));

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ status: "error", msg: expect.stringContaining("Unsupported platform") })
        );
    });

    test('EXTRACT_CONTENT handles successful extraction', async () => {
        mockActiveAdapter = {
            name: "ChatGPT",
            prepareForExtract: () => { },
            extract: () => ({ content: "valid content", messages: [] })
        };

        const sendResponse = jest.fn((res) => console.log('SEND RESPONSE CALLED', res));
        messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://chatgpt.com/c/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 600)); // wait for dynamic import and extraction

        console.log('SEND RESPONSE CALL COUNT', sendResponse.mock.calls.length);
        expect(sendResponse).toHaveBeenCalledWith({
            status: "success",
            data: { content: "valid content", messages: [] }
        });
    });

    test('SEND_ONLY sends and returns immediately', async () => {
        const mockSendMessage = jest.fn();
        mockActiveAdapter = {
            name: "Gemini",
            sendMessage: mockSendMessage
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'SEND_ONLY', text: "Hello", url: 'https://gemini.google.com/app/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(mockSendMessage).toHaveBeenCalledWith("Hello");
        expect(sendResponse).toHaveBeenCalledWith({ status: "success", sent: true });
    });

    test('SEND_ONLY routes correctly on ChatGPT URL', async () => {
        const mockSendMessage = jest.fn();
        mockActiveAdapter = {
            name: "ChatGPT",
            sendMessage: mockSendMessage
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'SEND_ONLY', text: "Hi ChatGPT", url: 'https://chatgpt.com/c/abc' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(mockSendMessage).toHaveBeenCalledWith("Hi ChatGPT");
        expect(sendResponse).toHaveBeenCalledWith({ status: "success", sent: true });
    });

    test('SEND_ONLY routes correctly on Claude URL', async () => {
        const mockSendMessage = jest.fn();
        mockActiveAdapter = {
            name: "Claude",
            sendMessage: mockSendMessage
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'SEND_ONLY', text: "Hi Claude", url: 'https://claude.ai/chat/abc' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(mockSendMessage).toHaveBeenCalledWith("Hi Claude");
        expect(sendResponse).toHaveBeenCalledWith({ status: "success", sent: true });
    });

    test('SEND_MESSAGE waits and extracts', async () => {
        mockActiveAdapter = {
            name: "Claude",
            sendMessage: () => { },
            waitForResponse: async () => { },
            prepareForExtract: () => { },
            extract: () => ({ content: "claude res", messages: [] })
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'SEND_MESSAGE', text: "Hello", url: 'https://claude.ai/chat/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 600)); // wait >500ms for prepareForExtract delay

        expect(sendResponse).toHaveBeenCalledWith({
            status: "success",
            sent: true,
            data: { content: "claude res", messages: [] }
        });
    });

    test('SEND_MESSAGE returns error if adapter lacks sendMessage', async () => {
        mockActiveAdapter = {
            name: "Mock" // missing sendMessage
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'SEND_MESSAGE', text: "Hello", url: 'https://chatgpt.com/c/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 50));

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ status: "error", msg: "This adapter does not support sending messages." })
        );
    });

    test('runAdapter throws if extraction fails validation', async () => {
        mockActiveAdapter = {
            name: "Mock",
            extract: () => ({}) // Missing content
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://chatgpt.com/c/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ status: "error", msg: expect.stringContaining("found no content") })
        );
    });

    test('extract crash returns error', async () => {
        mockActiveAdapter = {
            name: "Mock",
            extract: () => { throw new Error("Boom"); }
        };

        const sendResponse = jest.fn();
        messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://chatgpt.com/c/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ status: "error", msg: "Mock adapter crashed: Boom" })
        );
    });

    test('getAdapter throws on bad module export', async () => {
        // Mock a bad module
        jest.resetModules();
        jest.mock('../entrypoints/adapters/chatgpt.js', () => ({ default: "Not A Class" }));
        require('../entrypoints/content_extractor.js');
        messageHandler = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];

        const sendResponse = jest.fn();
        messageHandler({ type: 'EXTRACT_CONTENT', url: 'https://chatgpt.com/c/123' }, {}, sendResponse);

        await new Promise(r => setTimeout(r, 100));

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ status: "error", msg: expect.stringContaining("did not export a class") })
        );
    });

    test('unknown message type returns undefined', () => {
        const sendResponse = jest.fn();
        const result = messageHandler({ type: 'UNKNOWN_TYPE' }, {}, sendResponse);
        expect(result).toBeUndefined();
        expect(sendResponse).not.toHaveBeenCalled();
    });

    test('REXOW_CLOSED removes the floating button', () => {
        messageHandler({ type: 'REXOW_OPENED' }, {}, jest.fn());
        expect(document.getElementById('rexow-float-btn')).not.toBeNull();

        const sendResponse = jest.fn();
        messageHandler({ type: 'REXOW_CLOSED' }, {}, sendResponse);

        expect(document.getElementById('rexow-float-btn')).toBeNull();
    });

    test('REXOW_CLOSED does nothing if button already removed', () => {
        // Remove button first
        const btn = document.getElementById('rexow-float-btn');
        if (btn) btn.remove();
        expect(document.getElementById('rexow-float-btn')).toBeNull();

        // Should not throw
        expect(() => {
            messageHandler({ type: 'REXOW_CLOSED' }, {}, jest.fn());
        }).not.toThrow();
    });
});
