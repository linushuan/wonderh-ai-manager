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

// ── getApiKey / saveApiKey ───────────────────────────────────

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

test('saveApiKey stores key in chrome.storage.local', async () => {
    mockSet.mockImplementation((_, cb) => cb());
    await api.saveApiKey("sk-new");
    expect(mockSet).toHaveBeenCalledWith({ apiKey: "sk-new" }, expect.any(Function));
});
