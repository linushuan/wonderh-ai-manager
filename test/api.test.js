/**
 * tests/unit/api.test.js
 */

const mockGet = jest.fn();
const mockSet = jest.fn();
global.chrome = {
    storage: {
        local: {
            get: mockGet,
            set: mockSet
        }
    },
    runtime: {
        lastError: null
    }
};

let api;
beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
    api = require('../entrypoints/dashboard/api.js');
});

// ── generateSummary ──────────────────────────────────────────

test('generateSummary returns summary text on success', async () => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
            choices: [{ message: { content: "Summary bullet points" } }]
        })
    });

    const result = await api.generateSummary("long conversation text", "sk-test");
    expect(result).toBe("Summary bullet points");
});

test('generateSummary sends correct Authorization header', async () => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: "ok" } }] })
    });

    await api.generateSummary("content", "sk-mykey");
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer sk-mykey");
});

test('generateSummary throws on non-200 response', async () => {
    global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: "Rate limit exceeded" } })
    });

    await expect(api.generateSummary("content", "sk-test"))
        .rejects.toThrow("Rate limit exceeded");
});

test('generateSummary truncates content to 12000 chars', async () => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: "ok" } }] })
    });

    const longContent = "x".repeat(20000);
    await api.generateSummary(longContent, "sk-test");

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content.length).toBe(12000);
});

test('generateSummary throws on empty content', async () => {
    await expect(api.generateSummary("", "sk-test")).rejects.toThrow("No content to summarise.");
    await expect(api.generateSummary(null, "sk-test")).rejects.toThrow("No content to summarise.");
});

test('generateSummary throws on invalid API key format', async () => {
    await expect(api.generateSummary("content", "invalid-key")).rejects.toThrow("Invalid API key format");
});

test('generateSummary throws on fetch network error', async () => {
    global.fetch.mockRejectedValue(new Error("Network failure"));
    await expect(api.generateSummary("content", "sk-test")).rejects.toThrow("Network error: could not reach OpenAI");
});

test('generateSummary throws on specific HTTP errors', async () => {
    const errorCases = [
        { status: 401, msg: "Invalid API key" },
        { status: 429, msg: "Rate limit exceeded" },
        { status: 500, msg: "OpenAI server error" },
        { status: 403, msg: "Forbidden", body: { error: { message: "Forbidden text" } } },
    ];

    for (const ec of errorCases) {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: ec.status,
            json: () => Promise.resolve(ec.body || {})
        });
        if (ec.status === 403) {
            await expect(api.generateSummary("content", "sk-test")).rejects.toThrow("Forbidden text");
        } else {
            await expect(api.generateSummary("content", "sk-test")).rejects.toThrow(ec.msg);
        }
    }
});

test('generateSummary throws on invalid JSON response', async () => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Parse error"))
    });
    await expect(api.generateSummary("content", "sk-test")).rejects.toThrow("Could not parse API response");
});

test('generateSummary throws on empty summary text', async () => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [] })
    });
    await expect(api.generateSummary("content", "sk-test")).rejects.toThrow("API returned an empty summary");
});


test('getApiKey returns stored key', async () => {
    mockGet.mockImplementation((_, cb) => cb({ apiKey: "sk-stored" }));
    const key = await api.getApiKey();
    expect(key).toBe("sk-stored");
});

test('getApiKey returns null when not set', async () => {
    mockGet.mockImplementation((_, cb) => cb({}));
    const key = await api.getApiKey();
    expect(key).toBeNull();
});

test('getApiKey returns null when chrome.runtime.lastError is set', async () => {
    global.chrome.runtime.lastError = { message: "Storage error" };
    mockGet.mockImplementation((_, cb) => cb({}));

    // Suppress console.error in test output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const key = await api.getApiKey();
    expect(key).toBeNull();
    consoleSpy.mockRestore();
    global.chrome.runtime.lastError = null;
});

test('getApiKey returns null if storage access throws', async () => {
    mockGet.mockImplementation(() => { throw new Error("Sync error"); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const key = await api.getApiKey();
    expect(key).toBeNull();
    consoleSpy.mockRestore();
});

test('saveApiKey stores key in chrome.storage.local', async () => {
    mockSet.mockImplementation((_, cb) => cb());
    await api.saveApiKey("sk-new");
    expect(mockSet).toHaveBeenCalledWith({ apiKey: "sk-new" }, expect.any(Function));
});

test('saveApiKey rejects on empty key', async () => {
    await expect(api.saveApiKey("   ")).rejects.toThrow("API key cannot be empty.");
});

test('saveApiKey rejects on chrome.runtime.lastError', async () => {
    global.chrome.runtime.lastError = { message: "Set failed" };
    mockSet.mockImplementation((_, cb) => cb());
    await expect(api.saveApiKey("sk-new")).rejects.toThrow("Set failed");
    global.chrome.runtime.lastError = null;
});

test('saveApiKey rejects if storage set throws synchronously', async () => {
    mockSet.mockImplementation(() => { throw new Error("Sync error"); });
    await expect(api.saveApiKey("sk-new")).rejects.toThrow("Sync error");
});
