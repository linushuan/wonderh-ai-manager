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

describe('content_extractor', () => {
    let messageHandler;

    beforeEach(() => {
        document.body.innerHTML = '';
        chrome.runtime.onMessage.addListener.mockClear();
        chrome.runtime.sendMessage.mockClear();

        // Require the module, which registers the listener
        jest.resetModules();
        require('../entrypoints/content_extractor.js');

        // Get the registered message handler
        messageHandler = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    });

    test('injects "Back to REXOW" button on load', () => {
        const btn = document.getElementById('rexow-float-btn');
        expect(btn).not.toBeNull();
        expect(btn.innerText).toBe('Back to REXOW');
    });

    test('does not duplicate button on re-injection', () => {
        // Button should already exist from beforeEach
        const existingBtn = document.getElementById('rexow-float-btn');
        expect(existingBtn).not.toBeNull();

        // Try to re-inject
        require('../entrypoints/content_extractor.js');
        const buttons = document.querySelectorAll('#rexow-float-btn');
        expect(buttons.length).toBe(1);
    });

    test('message handler exists', () => {
        expect(typeof messageHandler).toBe('function');
    });

    test('EXTRACT_CONTENT returns true for async', () => {
        const sendResponse = jest.fn();
        const result = messageHandler(
            { type: 'EXTRACT_CONTENT' },
            {},
            sendResponse
        );
        expect(result).toBe(true);
    });

    test('SEND_MESSAGE returns true for async', () => {
        const sendResponse = jest.fn();
        const result = messageHandler(
            { type: 'SEND_MESSAGE', text: 'test', url: 'https://gemini.google.com/chat/test' },
            {},
            sendResponse
        );
        expect(result).toBe(true);
    });

    test('unknown message type returns undefined', () => {
        const sendResponse = jest.fn();
        const result = messageHandler(
            { type: 'UNKNOWN_TYPE' },
            {},
            sendResponse
        );
        expect(result).toBeUndefined();
        expect(sendResponse).not.toHaveBeenCalled();
    });
});
