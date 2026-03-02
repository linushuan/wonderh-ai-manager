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

test('extracts messages from .font-claude-message elements', () => {
    setDOM(`
        <div class="font-claude-message">First message</div>
        <div class="font-claude-message">Second message</div>`);
    const result = new ClaudeAdapter().extract();
    expect(result.content).toContain("First message");
    expect(result.content).toContain("Second message");
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
