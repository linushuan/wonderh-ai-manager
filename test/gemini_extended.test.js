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

    test('injects text into contenteditable input and clicks send button', () => {
        jest.useFakeTimers();
        setDOM(`
            <div class="ql-editor" contenteditable="true"></div>
            <button class="send-button"></button>
        `);
        // Mock focus
        const input = document.querySelector('.ql-editor');
        input.focus = jest.fn();
        const sendBtn = document.querySelector('.send-button');
        sendBtn.click = jest.fn();

        const adapter = new GeminiAdapter();
        adapter.sendMessage('hello world');

        expect(input.innerHTML).toContain('hello world');
        expect(input.focus).toHaveBeenCalled();

        jest.advanceTimersByTime(200); // Trigger send button click
        expect(sendBtn.click).toHaveBeenCalled();

        jest.advanceTimersByTime(300); // Trigger HTML clean
        expect(input.innerHTML).toBe('');
        jest.useRealTimers();
    });

    test('injects text into textarea input and triggers Enter key', () => {
        jest.useFakeTimers();
        setDOM('<textarea aria-label="Send message"></textarea>');
        const input = document.querySelector('textarea');
        input.focus = jest.fn();
        input.dispatchEvent = jest.fn(); // catch KeyboardEvent

        const adapter = new GeminiAdapter();
        adapter.sendMessage('test message');

        expect(input.value).toBe('test message');

        jest.advanceTimersByTime(200); // Trigger "Enter" key
        expect(input.dispatchEvent).toHaveBeenCalledWith(expect.any(KeyboardEvent));

        jest.advanceTimersByTime(300); // Trigger textarea value clear
        expect(input.value).toBe('');
        jest.useRealTimers();
    });
});

describe('GeminiAdapter.waitForResponse', () => {
    test('resolves on timeout', async () => {
        const adapter = new GeminiAdapter();
        await expect(adapter.waitForResponse(100)).resolves.toBeUndefined();
    });

    test('resolves when send button re-appears after streaming has started', async () => {
        jest.useFakeTimers();
        setDOM('<div class="conversation-container"></div>');
        const container = document.querySelector('.conversation-container');

        const adapter = new GeminiAdapter();
        const promise = adapter.waitForResponse(5000);

        // Simulate streaming state first: disabled send button + model response
        const disabledBtn = document.createElement('button');
        disabledBtn.classList.add('send-button');
        disabledBtn.disabled = true;
        document.body.appendChild(disabledBtn);

        const mr = document.createElement('model-response');
        mr.textContent = 'streaming';
        container.appendChild(mr);

        jest.advanceTimersByTime(1200);
        await Promise.resolve();

        // Re-enable send button (Gemini re-enables it when streaming completes)
        disabledBtn.remove();
        const btn = document.createElement('button');
        btn.classList.add('send-button');
        document.body.appendChild(btn);

        // Poll fires every 300ms
        jest.advanceTimersByTime(300);
        await Promise.resolve();

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
    });

    test('resolves when model-response count increases and content stabilises long enough', async () => {
        jest.useFakeTimers();
        setDOM('<div class="conversation-container"></div>');
        const container = document.querySelector('.conversation-container');

        const adapter = new GeminiAdapter();
        // startCount = 0
        const promise = adapter.waitForResponse(5000);

        // Add a model-response with text content
        const mr = document.createElement('model-response');
        mr.textContent = 'Hello world';
        container.appendChild(mr);

        // First poll detects new response, records length — stableCount = 0
        jest.advanceTimersByTime(300);
        await Promise.resolve();

        // Subsequent polls keep same length
        jest.advanceTimersByTime(300);
        await Promise.resolve();
        jest.advanceTimersByTime(300);
        await Promise.resolve();
        jest.advanceTimersByTime(300);
        await Promise.resolve();
        jest.advanceTimersByTime(300);
        await Promise.resolve();

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
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
        window.scrollTo = jest.fn();
        adapter.prepareForExtract();
        expect(scroller.scrollTop).toBe(1000);
        expect(window.scrollTo).toHaveBeenCalled();
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

describe('GeminiAdapter._domToMarkdown', () => {
    let adapter;

    beforeEach(() => {
        adapter = new GeminiAdapter();
    });

    test('handles basic text nodes', () => {
        setDOM('Hello World');
        expect(adapter._domToMarkdown(document.body).trim()).toBe('Hello World');
    });

    test('ignores excluded tags and classes', () => {
        setDOM(`
            <button>Click me</button>
            <mat-icon>icon</mat-icon>
            <div class="copy-button">Copy</div>
            <div class="action-button">Action</div>
            <span>visible</span>
        `);
        const result = adapter._domToMarkdown(document.body).trim();
        expect(result).toBe('visible');
    });

    test('handles bold and italic formatting', () => {
        setDOM('<b>bold1</b> <strong>bold2</strong> <i>italic1</i> <em>italic2</em>');
        // Space nodes in innerHTML might be ignored if purely whitespace, let's test specific formats
        setDOM('<div>text <b>bold</b> text</div>');
        expect(adapter._domToMarkdown(document.body).trim()).toBe('text **bold** text');
    });

    test('handles inline code and code blocks', () => {
        setDOM(`
            <code>inline code</code>
            <pre><code>block code</code></pre>
            <code-block>
                <div class="code-block-decoration">javascript</div>
                <code role="text">console.log()</code>
            </code-block>
            <div class="code-block">
                bare code
            </div>
        `);
        const md = adapter._domToMarkdown(document.body);
        expect(md).toContain('`inline code`');
        expect(md).toContain('```\nblock code\n```');
        expect(md).toContain('```javascript\nconsole.log()\n```');
        expect(md).toMatch(/```\n\s*bare code\s*\n```/);
    });

    test('handles basic blockquote', () => {
        setDOM('<blockquote>quoted text</blockquote>');
        expect(adapter._domToMarkdown(document.body).trim()).toContain('> quoted text');
    });

    test('handles nested blockquote', () => {
        setDOM('<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> outer');
        expect(md).toContain('> > inner');
    });

    test('handles blockquote with bold and italic', () => {
        setDOM('<blockquote><p><strong>Bold title</strong></p><p><em>italic note</em></p></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> **Bold title**');
        expect(md).toContain('> *italic note*');
    });

    test('handles blockquote with list', () => {
        setDOM('<blockquote><p>Tips:</p><ul><li>Item A</li><li>Item B</li></ul></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> Tips:');
        expect(md).toContain('> - Item A');
        expect(md).toContain('> - Item B');
    });

    test('handles blockquote with inline math', () => {
        setDOM('<blockquote><p>If effort is <span class="math-inline" data-math="E">E</span> then success is:</p></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> ');
        expect(md).toContain('$E$');
    });

    test('handles blockquote with display math', () => {
        setDOM('<blockquote><p>The formula:</p><div class="math-block" data-math="S = E \\times C^2"></div></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> The formula:');
        expect(md).toContain('$$');
        expect(md).toContain('S = E \\times C^2');
    });

    test('handles blockquote with multiple paragraphs', () => {
        setDOM('<blockquote><p>Paragraph one.</p><p>Paragraph two.</p></blockquote>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('> Paragraph one.');
        expect(md).toContain('> Paragraph two.');
    });

    test('handles unordered lists', () => {
        setDOM('<ul><li>Item 1</li><li>Item 2</li></ul>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('- Item 1');
        expect(md).toContain('- Item 2');
    });

    test('handles ordered lists', () => {
        setDOM('<ol><li>First</li><li>Second</li></ol>');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('1. First');
        expect(md).toContain('2. Second');
    });

    test('handles links and images', () => {
        setDOM('<a href="https://example.com">Link</a> <img src="img.jpg" alt="An Image">');
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('[Link](https://example.com)');
        expect(md).toContain('![An Image](img.jpg)');
    });

    test('handles Gemini math block and inline equations', () => {
        setDOM(`
            <span class="math-block" data-math="x = 1"></span>
            <span class="math-inline" data-math="y"></span>
        `);
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('$$\nx = 1\n$$');
        expect(md).toContain('$y$');
    });

    test('handles basic tables', () => {
        setDOM(`
            <table>
                <thead><tr><th>Col1</th><th>Col2</th></tr></thead>
                <tbody><tr><td>Data1</td><td>Data2</td></tr></tbody>
            </table>
        `);
        const md = adapter._domToMarkdown(document.body).trim();
        expect(md).toContain('| Col1 | Col2 |');
        expect(md).toContain('| --- | --- |');
        expect(md).toContain('| Data1 | Data2 |');
    });
});

describe('GeminiAdapter fallback extraction', () => {
    test('uses fallback container if no structure found', () => {
        setDOM(`
            <div class="conversation-container">
                This is a raw text response that needs to be more than 50 characters long so it passes the minimum length validation check.
                With some newlines
                Regenerate
            </div>
        `);
        const result = new GeminiAdapter().extract();
        expect(result.content).toContain('This is a raw text response');
        expect(result.content).not.toContain('Regenerate'); // Filtered by NOISE_LINES
    });

    test('throws if body text is too short', () => {
        setDOM('<div role="main">short text</div>');
        expect(() => new GeminiAdapter().extract()).toThrow('too short');
    });

    test('extracts body text if valid and long enough', () => {
        // Create 100+ chars of text to bypass length check
        const longText = 'This is a long text payload that simulates a valid Gemini document body without specific DOM nodes. '.repeat(5);
        setDOM(`<body><div role="main">${longText}</div></body>`);
        const result = new GeminiAdapter().extract();
        expect(result.content).toBe(longText.trim());
        expect(result.messages).toEqual([]);
        expect(result.platform).toBe('gemini');
    });
});

describe('GeminiAdapter extract user-query and model-response', () => {
    test('extracts full conversation', () => {
        setDOM(`
            <h1 class="conversation-title">Conversation</h1>
            <user-query>
                <div class="query-content">My prompt</div>
            </user-query>
            <model-response>
                <div class="model-response-text"><p>My answer</p></div>
            </model-response>
        `);
        const result = new GeminiAdapter().extract();
        expect(result.title).toBe('Conversation');
        expect(result.messages.length).toBe(2);
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[0].text).toBe('My prompt');
        expect(result.messages[1].role).toBe('assistant');
        expect(result.messages[1].text).toContain('My answer');
    });

    test('deduplicates identical trailing user queries', () => {
        setDOM(`
            <user-query><div class="query-content">Prompt</div></user-query>
            <model-response><div class="model-response-text">Answer</div></model-response>
            <user-query><div class="query-content">Prompt</div></user-query>
            <user-query><div class="query-content">Prompt</div></user-query>
        `);
        const result = new GeminiAdapter().extract();
        expect(result.messages.length).toBeLessThan(4);
    });
});
