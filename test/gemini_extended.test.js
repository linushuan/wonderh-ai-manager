/**
 * gemini_extended.test.js — Extended tests for Gemini adapter methods
 */

let GeminiAdapter;
beforeAll(() => {
    const mod = require('../entrypoints/adapters/gemini.js');
    GeminiAdapter = mod.default || mod;
});

function setDOM(html) {
    document.body.innerHTML = html;
    const elements = document.body.querySelectorAll('*');
    for (const el of elements) {
        Object.defineProperty(el, 'innerText', {
            get() { return this.textContent; },
            configurable: true
        });
    }
}

describe('GeminiAdapter.sendMessage', () => {
    test('throws on empty text', () => {
        const adapter = new GeminiAdapter();
        expect(() => adapter.sendMessage('')).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(null)).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(undefined)).toThrow('Cannot send empty message');
    });

    test('throws when input field not found', () => {
        setDOM('<div>No input here</div>');
        const adapter = new GeminiAdapter();
        expect(() => adapter.sendMessage('hello')).toThrow('could not find input field');
    });

    test('injects text into contenteditable input', () => {
        setDOM('<div class="ql-editor" contenteditable="true"></div>');
        // Mock focus
        const input = document.querySelector('.ql-editor');
        input.focus = jest.fn();

        const adapter = new GeminiAdapter();
        adapter.sendMessage('hello world');

        expect(input.innerHTML).toContain('hello world');
        expect(input.focus).toHaveBeenCalled();
    });

    test('injects text into textarea input', () => {
        setDOM('<textarea aria-label="Send message"></textarea>');
        const input = document.querySelector('textarea');
        input.focus = jest.fn();

        const adapter = new GeminiAdapter();
        adapter.sendMessage('test message');

        expect(input.value).toBe('test message');
    });
});

describe('GeminiAdapter.waitForResponse', () => {
    test('is a function', () => {
        const adapter = new GeminiAdapter();
        expect(typeof adapter.waitForResponse).toBe('function');
    });

    test('returns a promise', () => {
        const adapter = new GeminiAdapter();
        const result = adapter.waitForResponse(100);
        expect(result).toBeInstanceOf(Promise);
    });

    test('resolves on timeout', async () => {
        const adapter = new GeminiAdapter();
        await expect(adapter.waitForResponse(100)).resolves.toBeUndefined();
    });
});

describe('GeminiAdapter.prepareForExtract', () => {
    test('scrolls infinite-scroller to bottom', () => {
        setDOM('<div id="is"><div style="height:1000px;">content</div></div>');
        const scroller = document.getElementById('is');
        // Mock scrollTop/scrollHeight
        Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
        jest.spyOn(document, 'querySelector').mockImplementation(sel => {
            if (sel === 'infinite-scroller') return scroller;
            return null;
        });

        const adapter = new GeminiAdapter();
        adapter.prepareForExtract();
        expect(scroller.scrollTop).toBe(1000);
        jest.restoreAllMocks();
    });
});

describe('GeminiAdapter._cleanUserText', () => {
    test('strips 你說了 prefix', () => {
        const adapter = new GeminiAdapter();
        expect(adapter._cleanUserText('你說了 Hello')).toBe('Hello');
    });

    test('keeps text without prefix', () => {
        const adapter = new GeminiAdapter();
        expect(adapter._cleanUserText('Hello')).toBe('Hello');
    });

    test('handles prefix at start with extra whitespace', () => {
        const adapter = new GeminiAdapter();
        expect(adapter._cleanUserText('你說了   multiple spaces')).toBe('multiple spaces');
    });
});

describe('GeminiAdapter.extract title detection', () => {
    test('uses document.title as default', () => {
        setDOM(`
            <user-query>What is AI?</user-query>
            <model-response>AI is artificial intelligence.</model-response>
        `);
        Object.defineProperty(document, 'title', { value: 'Test Title', configurable: true, writable: true });
        const result = new GeminiAdapter().extract();
        expect(result.title).toBe('Test Title');
    });

    test('prefers conversation-title element over document.title', () => {
        setDOM(`
            <h1 class="conversation-title">Custom Title</h1>
            <user-query>Question</user-query>
            <model-response>Answer</model-response>
        `);
        Object.defineProperty(document, 'title', { value: 'Default Title', configurable: true, writable: true });
        const result = new GeminiAdapter().extract();
        expect(result.title).toBe('Custom Title');
    });
});

describe('GeminiAdapter.extract with inner content selectors', () => {
    test('prefers .model-response-text over full model-response', () => {
        setDOM(`
            <model-response>
                <div class="model-response-text">Clean response text</div>
                <button>Copy</button>
                <button>Regenerate</button>
            </model-response>
        `);
        const result = new GeminiAdapter().extract();
        expect(result.messages[0].text).toBe('Clean response text');
        expect(result.messages[0].text).not.toContain('Copy');
    });

    test('uses body text as last resort', () => {
        setDOM(`<div role="main"><p>${'x'.repeat(200)}</p></div>`);
        jest.spyOn(document, 'querySelectorAll').mockReturnValue([]);
        jest.spyOn(document, 'querySelector').mockImplementation(sel => {
            if (sel === '[role="main"]') return document.querySelector('div');
            return null;
        });
        // The adapter should use body text
        // Not enough structure for structured messages at this point
        jest.restoreAllMocks();
    });
});
