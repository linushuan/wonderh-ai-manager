/**
 * tests/unit/adapters/chatgpt.test.js
 */

let ChatGPTAdapter;
beforeAll(() => {
    const mod = require('../entrypoints/adapters/chatgpt.js');
    ChatGPTAdapter = mod.default || mod;
});

function setDOM(html) {
    document.body.innerHTML = html;
    // JSDOM doesn't implement innerText, which our adapters use.
    // Polyfill it for all elements in the body
    const elements = document.body.querySelectorAll('*');
    for (const el of elements) {
        Object.defineProperty(el, 'innerText', {
            get() { return this.textContent; },
            configurable: true
        });
    }
}

test('extracts messages with correct roles', () => {
    setDOM(`
        <main>
            <div data-message-author-role="user">Hello</div>
            <div data-message-author-role="assistant">Hi there</div>
        </main>`);
    const result = new ChatGPTAdapter().extract();
    expect(result.platform).toBe("chatgpt");
    expect(result.content).toContain("[USER]");
    expect(result.content).toContain("[ASSISTANT]");
    expect(result.content).toContain("Hello");
});

test('strips visible "LaTeX" language header line from ChatGPT code block', () => {
    setDOM(`
        <main>
            <div data-message-author-role="assistant">
                <pre><code>LaTeX
\\[
a^2 + b^2 = c^2
\\]</code></pre>
            </div>
        </main>`);
    const result = new ChatGPTAdapter().extract();
    expect(result.content).toContain('\\[');
    expect(result.content).not.toContain('```\nLaTeX\n');
});

test('fallback to main.innerText when no role nodes found', () => {
    setDOM(`<main><p>Some text here</p></main>`);
    const result = new ChatGPTAdapter().extract();
    expect(result.content).toBe(document.querySelector('main').innerText);
});

test('throws when main element is missing', () => {
    setDOM(`<div>No main here</div>`);
    expect(() => new ChatGPTAdapter().extract()).toThrow();
});

/**
 * tests/unit/adapters/gemini.test.js
 */
let GeminiAdapter;
beforeAll(() => {
    const mod = require('../entrypoints/adapters/gemini.js');
    GeminiAdapter = mod.default || mod;
});

test('extracts structured messages with roles from custom elements', () => {
    setDOM(`
        <div id="infinite-scroller">
            <user-query>What is the capital of France?</user-query>
            <model-response>The capital of France is Paris.</model-response>
        </div>`);

    const orig = document.querySelector.bind(document);
    jest.spyOn(document, 'querySelector').mockImplementation((sel) => {
        if (sel === 'infinite-scroller') return document.getElementById('infinite-scroller');
        return orig(sel);
    });

    const result = new GeminiAdapter().extract();
    expect(result.platform).toBe("gemini");
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]).toEqual({ role: "user", text: "What is the capital of France?" });
    expect(result.messages[1]).toEqual({ role: "assistant", text: "The capital of France is Paris." });
    expect(result.content).toContain("What is the capital of France?");
    expect(result.content).toContain("The capital of France is Paris.");

    jest.restoreAllMocks();
});

test('filters noise lines from Gemini output when structured elements are missing', () => {
    // No <user-query> or <model-response> — adapter falls back to container text filtering
    setDOM(`
        <div id="infinite-scroller">
        Line 1 of the conversation that is long enough to pass the length check
        Show drafts
        Actual content that represents a real conversation message from the model
        Regenerate
        More content that is meaningful and represents actual conversation text here
        </div>`);
    // Patch querySelector for test — map 'infinite-scroller' tag to the div by id
    const orig = document.querySelector.bind(document);
    jest.spyOn(document, 'querySelector').mockImplementation((sel) => {
        if (sel === 'infinite-scroller') return document.getElementById('infinite-scroller');
        return orig(sel);
    });
    const result = new GeminiAdapter().extract();
    expect(result.messages).toEqual([]); // Fallback doesn't set roles
    expect(result.content).not.toContain("Show drafts");
    expect(result.content).not.toContain("Regenerate");
    expect(result.content).toContain("Actual content");
    jest.restoreAllMocks();
});

test('strips "你說了" prefix from user query text', () => {
    setDOM(`
        <div id="infinite-scroller">
            <user-query>你說了 What is the capital of France?</user-query>
            <model-response>The capital of France is Paris.</model-response>
        </div>`);

    const orig = document.querySelector.bind(document);
    jest.spyOn(document, 'querySelector').mockImplementation((sel) => {
        if (sel === 'infinite-scroller') return document.getElementById('infinite-scroller');
        return orig(sel);
    });

    const result = new GeminiAdapter().extract();
    expect(result.messages[0].text).toBe("What is the capital of France?");
    expect(result.messages[0].text).not.toContain("你說了");

    jest.restoreAllMocks();
});

test('throws when page content is too short', () => {
    setDOM(`<p>Hi</p>`);
    jest.spyOn(document, 'querySelector').mockReturnValue(null);
    expect(() => new GeminiAdapter().extract()).toThrow();
    jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────

/**
 * tests/unit/adapters/claude.test.js
 */
let ClaudeAdapter;
beforeAll(() => {
    const mod = require('../entrypoints/adapters/claude.js');
    ClaudeAdapter = mod.default || mod;
});

test('extracts user and assistant messages from Claude turn structure', () => {
    setDOM(`
        <main>
            <div data-testid="user-human-turn-0">First user message</div>
            <div><div class="font-claude-message">First assistant message</div></div>
        </main>`);
    const result = new ClaudeAdapter().extract();
    expect(result.messages[0]).toEqual({ role: 'user', text: 'First user message' });
    expect(result.messages[1]).toEqual({ role: 'assistant', text: 'First assistant message' });
    expect(result.platform).toBe("claude");
});

test('fallback to .grid-cols-1 when no font-claude-message', () => {
    setDOM(`<div class="grid-cols-1">Fallback content here</div>`);
    const result = new ClaudeAdapter().extract();
    expect(result.content).toContain("Fallback content");
});

test('throws when no recognisable structure', () => {
    setDOM(`<div class="unrelated">Nothing here</div>`);
    expect(() => new ClaudeAdapter().extract()).toThrow();
});

// ─────────────────────────────────────────────────────────────

/**
 * ChatGPT sendMessage / waitForResponse / prepareForExtract
 */
describe('ChatGPTAdapter.sendMessage', () => {
    test('throws on empty text', () => {
        const adapter = new ChatGPTAdapter();
        expect(() => adapter.sendMessage('')).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(null)).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(undefined)).toThrow('Cannot send empty message');
    });

    test('throws when input field not found', () => {
        setDOM('<div>No input here</div>');
        expect(() => new ChatGPTAdapter().sendMessage('hello')).toThrow('could not find input field');
    });

    test('injects text into contenteditable div and clicks send button', () => {
        jest.useFakeTimers();
        setDOM(`
            <main>
                <div id="prompt-textarea" contenteditable="true"></div>
                <button data-testid="send-button"></button>
            </main>`);
        const input = document.querySelector('#prompt-textarea');
        input.focus = jest.fn();
        const sendBtn = document.querySelector('[data-testid="send-button"]');
        sendBtn.click = jest.fn();

        new ChatGPTAdapter().sendMessage('hello world');

        expect(input.innerHTML).toContain('hello world');
        expect(input.focus).toHaveBeenCalled();

        jest.advanceTimersByTime(200);
        expect(sendBtn.click).toHaveBeenCalled();

        jest.advanceTimersByTime(300);
        expect(input.innerHTML).toBe('');
        jest.useRealTimers();
    });

    test('injects text into textarea and triggers Enter when send button disabled', () => {
        jest.useFakeTimers();
        setDOM('<main><textarea placeholder="Send a message"></textarea></main>');
        const input = document.querySelector('textarea');
        input.focus = jest.fn();
        input.dispatchEvent = jest.fn();

        new ChatGPTAdapter().sendMessage('test message');

        expect(input.value).toBe('test message');

        jest.advanceTimersByTime(200);
        expect(input.dispatchEvent).toHaveBeenCalledWith(expect.any(KeyboardEvent));

        jest.advanceTimersByTime(300);
        expect(input.value).toBe('');
        jest.useRealTimers();
    });
});

describe('ChatGPTAdapter.waitForResponse', () => {
    test('resolves on timeout', async () => {
        const adapter = new ChatGPTAdapter();
        await expect(adapter.waitForResponse(100)).resolves.toBeUndefined();
    });

    test('resolves early when send button re-appears after mutations', async () => {
        jest.useFakeTimers();
        setDOM('<main></main>');
        const container = document.querySelector('main');

        const adapter = new ChatGPTAdapter();
        const promise = adapter.waitForResponse(5000);

        // Trigger a mutation
        container.appendChild(document.createElement('div'));
        await Promise.resolve();

        // Add a non-disabled send button
        const btn = document.createElement('button');
        btn.setAttribute('data-testid', 'send-button');
        document.body.appendChild(btn);

        jest.advanceTimersByTime(1500);
        await Promise.resolve();

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
    });

    test('resolves when new assistant message count increases', async () => {
        jest.useFakeTimers();
        setDOM('<main></main>');
        const container = document.querySelector('main');

        const adapter = new ChatGPTAdapter();
        const promise = adapter.waitForResponse(5000);

        jest.advanceTimersByTime(100);
        const msg = document.createElement('div');
        msg.setAttribute('data-message-author-role', 'assistant');
        container.appendChild(msg);
        await Promise.resolve();

        jest.advanceTimersByTime(1500);
        await Promise.resolve();
        jest.advanceTimersByTime(2500);

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
    });
});

describe('ChatGPTAdapter.prepareForExtract', () => {
    test('scrolls main element and window to bottom', () => {
        setDOM('<main id="m"><div style="height:1000px;"></div></main>');
        const main = document.querySelector('main');
        Object.defineProperty(main, 'scrollHeight', { value: 1000, configurable: true });
        window.scrollTo = jest.fn();

        new ChatGPTAdapter().prepareForExtract();

        expect(main.scrollTop).toBe(1000);
        expect(window.scrollTo).toHaveBeenCalledWith(0, document.body.scrollHeight);
    });
});

// ─────────────────────────────────────────────────────────────

/**
 * Claude sendMessage / waitForResponse / prepareForExtract
 */
describe('ClaudeAdapter.sendMessage', () => {
    test('throws on empty text', () => {
        const adapter = new ClaudeAdapter();
        expect(() => adapter.sendMessage('')).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(null)).toThrow('Cannot send empty message');
        expect(() => adapter.sendMessage(undefined)).toThrow('Cannot send empty message');
    });

    test('throws when input field not found', () => {
        setDOM('<div>No input here</div>');
        expect(() => new ClaudeAdapter().sendMessage('hello')).toThrow('could not find input field');
    });

    test('injects text into ProseMirror and clicks send button', () => {
        jest.useFakeTimers();
        setDOM(`
            <div class="ProseMirror" contenteditable="true"></div>
            <button aria-label="Send Message"></button>`);
        const input = document.querySelector('.ProseMirror');
        input.focus = jest.fn();
        const sendBtn = document.querySelector('button[aria-label="Send Message"]');
        sendBtn.click = jest.fn();

        new ClaudeAdapter().sendMessage('hello claude');

        expect(input.innerHTML).toContain('hello claude');
        expect(input.focus).toHaveBeenCalled();

        jest.advanceTimersByTime(200);
        expect(sendBtn.click).toHaveBeenCalled();

        jest.advanceTimersByTime(300);
        expect(input.innerHTML).toBe('');
        jest.useRealTimers();
    });

    test('falls back to Enter key when send button not found', () => {
        jest.useFakeTimers();
        setDOM('<div contenteditable="true" role="textbox"></div>');
        const input = document.querySelector('[contenteditable="true"]');
        input.focus = jest.fn();
        input.dispatchEvent = jest.fn();

        new ClaudeAdapter().sendMessage('test');

        jest.advanceTimersByTime(200);
        expect(input.dispatchEvent).toHaveBeenCalledWith(expect.any(KeyboardEvent));
        jest.useRealTimers();
    });
});

describe('ClaudeAdapter.waitForResponse', () => {
    test('resolves on timeout', async () => {
        const adapter = new ClaudeAdapter();
        await expect(adapter.waitForResponse(100)).resolves.toBeUndefined();
    });

    test('resolves early when send button re-appears after mutations', async () => {
        jest.useFakeTimers();
        setDOM('<main></main>');
        const container = document.querySelector('main');

        const adapter = new ClaudeAdapter();
        const promise = adapter.waitForResponse(5000);

        container.appendChild(document.createElement('div'));
        await Promise.resolve();

        const btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Send Message');
        document.body.appendChild(btn);

        jest.advanceTimersByTime(1500);
        await Promise.resolve();

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
    });

    test('resolves when new .font-claude-message count increases', async () => {
        jest.useFakeTimers();
        setDOM('<main></main>');
        const container = document.querySelector('main');

        const adapter = new ClaudeAdapter();
        const promise = adapter.waitForResponse(5000);

        jest.advanceTimersByTime(100);
        const msg = document.createElement('div');
        msg.className = 'font-claude-message';
        container.appendChild(msg);
        await Promise.resolve();

        jest.advanceTimersByTime(1500);
        await Promise.resolve();
        jest.advanceTimersByTime(2500);

        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
    });
});

describe('ClaudeAdapter.prepareForExtract', () => {
    test('scrolls main element and window to bottom', () => {
        setDOM('<main id="m"><div style="height:1000px;"></div></main>');
        const main = document.querySelector('main');
        Object.defineProperty(main, 'scrollHeight', { value: 1000, configurable: true });
        window.scrollTo = jest.fn();

        new ClaudeAdapter().prepareForExtract();

        expect(main.scrollTop).toBe(1000);
        expect(window.scrollTo).toHaveBeenCalledWith(0, document.body.scrollHeight);
    });
});

describe('ClaudeAdapter role detection (fixed)', () => {
    test('detects user role via data-testid="user-human-turn" and keeps assistant as non-human sibling', () => {
        setDOM(`
            <div data-testid="user-human-turn-0">Human message</div>
            <div>
                <div class="font-claude-message">Assistant message</div>
            </div>`);
        const result = new ClaudeAdapter().extract();
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[1].role).toBe('assistant');
    });

    test('does not misclassify assistant messages using [class*="user"] (bug fix)', () => {
        // A class name containing "user" in an unrelated ancestor should NOT make the message user
        setDOM(`
            <div class="user-content-wrapper">
                <div class="font-claude-message">Assistant reply</div>
            </div>`);
        const result = new ClaudeAdapter().extract();
        // "user-content-wrapper" should NOT trigger role=user because we no longer use [class*="user"]
        expect(result.messages[0].role).toBe('assistant');
    });
});

describe('ClaudeAdapter DOM walking', () => {
    test('_domToMarkdown extracts plain text', () => {
        setDOM('<div id="test"><p>Hello world</p></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        expect(adapter._domToMarkdown(el)).toBe('Hello world');
    });

    test('_domToMarkdown handles headings', () => {
        setDOM('<div id="test"><h1>Title</h1><h2>Subtitle</h2></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('# Title');
        expect(md).toContain('## Subtitle');
    });

    test('_domToMarkdown handles code blocks', () => {
        setDOM('<div id="test"><pre><code class="language-python">print("hello")</code></pre></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('```python');
        expect(md).toContain('print("hello")');
        expect(md).toContain('```');
    });

    test('_domToMarkdown handles bold and italic', () => {
        setDOM('<div id="test"><p><strong>bold</strong> and <em>italic</em></p></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('**bold**');
        expect(md).toContain('*italic*');
    });

    test('_domToMarkdown handles unordered lists', () => {
        setDOM('<div id="test"><ul><li>Item 1</li><li>Item 2</li></ul></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('- Item 1');
        expect(md).toContain('- Item 2');
    });

    test('_domToMarkdown handles ordered lists', () => {
        setDOM('<div id="test"><ol><li>First</li><li>Second</li></ol></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('1. First');
        expect(md).toContain('2. Second');
    });

    test('_domToMarkdown handles links', () => {
        setDOM('<div id="test"><p>Visit <a href="https://test.com">link</a></p></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('[link](https://test.com)');
    });

    test('_domToMarkdown handles inline code', () => {
        setDOM('<div id="test"><p>Use <code>foo()</code> function</p></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('`foo()`');
    });

    test('_domToMarkdown handles blockquotes', () => {
        setDOM('<div id="test"><blockquote>Quoted text</blockquote></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('> Quoted text');
    });

    test('_domToMarkdown handles tables', () => {
        setDOM(`<div id="test"><table>
            <thead><tr><th>Name</th><th>Value</th></tr></thead>
            <tbody><tr><td>A</td><td>1</td></tr></tbody>
        </table></div>`);
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('| Name | Value |');
        expect(md).toContain('| --- | --- |');
        expect(md).toContain('| A | 1 |');
    });

    test('_extractLatex extracts from annotation element', () => {
        setDOM(`<span id="test" class="katex">
            <span class="katex-mathml"><math><semantics>
                <annotation encoding="application/x-tex">x^2</annotation>
            </semantics></math></span>
            <span class="katex-html">x²</span>
        </span>`);
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        expect(adapter._extractLatex(el)).toBe('x^2');
    });

    test('_extractLatex extracts from data-math attribute', () => {
        setDOM('<span id="test" data-math="\\frac{a}{b}">rendered</span>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        expect(adapter._extractLatex(el)).toBe('\\frac{a}{b}');
    });

    test('_domToMarkdown handles KaTeX display math', () => {
        setDOM(`<div id="test"><span class="katex-display">
            <span class="katex-mathml"><math><semantics>
                <annotation encoding="application/x-tex">\\sum_{n=1}^{\\infty} \\frac{1}{n^2}</annotation>
            </semantics></math></span>
            <span class="katex-html">visible rendering</span>
        </span></div>`);
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('$$');
        expect(md).toContain('\\sum_{n=1}^{\\infty} \\frac{1}{n^2}');
    });

    test('_domToMarkdown handles KaTeX inline math', () => {
        setDOM(`<div id="test"><p>The value of <span class="katex">
            <span class="katex-mathml"><math><semantics>
                <annotation encoding="application/x-tex">x^2</annotation>
            </semantics></math></span>
            <span class="katex-html">x²</span>
        </span> is big</p></div>`);
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toContain('$x^2$');
        // Should NOT contain duplicated text from katex-html layer
        expect(md).not.toContain('x²');
    });

    test('_extractText uses DOM walking for assistant and innerText for user', () => {
        setDOM(`<div id="assistant"><p><strong>Bold</strong> text</p></div>
                <div id="user">Plain user text</div>`);
        const adapter = new ClaudeAdapter();
        const assistantEl = document.getElementById('assistant');
        const userEl = document.getElementById('user');
        expect(adapter._extractText(assistantEl, 'assistant')).toContain('**Bold**');
        expect(adapter._extractText(userEl, 'user')).toBe('Plain user text');
    });

    test('extract uses DOM walking for assistant messages', () => {
        setDOM(`
            <main>
                <div data-testid="user-human-turn-0">User question</div>
                <div><div class="font-claude-message"><p><strong>Bold</strong> and <code>code</code></p></div></div>
            </main>`);
        const result = new ClaudeAdapter().extract();
        expect(result.messages[1].role).toBe('assistant');
        expect(result.messages[1].text).toContain('**Bold**');
        expect(result.messages[1].text).toContain('`code`');
    });

    test('_domToMarkdown skips buttons and SVGs', () => {
        setDOM('<div id="test"><p>Text</p><button>Copy</button><svg></svg></div>');
        const adapter = new ClaudeAdapter();
        const el = document.getElementById('test');
        const md = adapter._domToMarkdown(el);
        expect(md).toBe('Text');
        expect(md).not.toContain('Copy');
    });
});
