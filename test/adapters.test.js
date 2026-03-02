/**
 * tests/unit/adapters/chatgpt.test.js
 */

let ChatGPTAdapter;
beforeAll(async () => {
    const mod = await import('../../../entrypoints/adapters/chatgpt.js');
    ChatGPTAdapter = mod.default;
});

function setDOM(html) {
    document.body.innerHTML = html;
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

// ─────────────────────────────────────────────────────────────

/**
 * tests/unit/adapters/gemini.test.js
 */
let GeminiAdapter;
beforeAll(async () => {
    const mod = await import('../../../entrypoints/adapters/gemini.js');
    GeminiAdapter = mod.default;
});

test('filters noise lines from Gemini output', () => {
    // jsdom doesn't support custom elements, so use a div with that class
    document.body.innerHTML = `
        <div id="infinite-scroller">
        Line 1
        Show drafts
        Actual content
        Regenerate
        More content
        </div>`;
    // Patch querySelector for test
    const orig = document.querySelector.bind(document);
    jest.spyOn(document, 'querySelector').mockImplementation((sel) => {
        if (sel === 'infinite-scroller') return document.getElementById('infinite-scroller');
        return orig(sel);
    });
    const result = new GeminiAdapter().extract();
    expect(result.content).not.toContain("Show drafts");
    expect(result.content).not.toContain("Regenerate");
    expect(result.content).toContain("Actual content");
    jest.restoreAllMocks();
});

test('throws when page content is too short', () => {
    document.body.innerHTML = `<p>Hi</p>`;
    jest.spyOn(document, 'querySelector').mockReturnValue(null);
    expect(() => new GeminiAdapter().extract()).toThrow();
    jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────

/**
 * tests/unit/adapters/claude.test.js
 */
let ClaudeAdapter;
beforeAll(async () => {
    const mod = await import('../../../entrypoints/adapters/claude.js');
    ClaudeAdapter = mod.default;
});

test('extracts messages from .font-claude-message elements', () => {
    document.body.innerHTML = `
        <div class="font-claude-message">First message</div>
        <div class="font-claude-message">Second message</div>`;
    const result = new ClaudeAdapter().extract();
    expect(result.content).toContain("First message");
    expect(result.content).toContain("Second message");
    expect(result.platform).toBe("claude");
});

test('fallback to .grid-cols-1 when no font-claude-message', () => {
    document.body.innerHTML = `<div class="grid-cols-1">Fallback content here</div>`;
    const result = new ClaudeAdapter().extract();
    expect(result.content).toContain("Fallback content");
});

test('throws when no recognisable structure', () => {
    document.body.innerHTML = `<div class="unrelated">Nothing here</div>`;
    expect(() => new ClaudeAdapter().extract()).toThrow();
});
