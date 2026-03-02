/**
 * tests/unit/store.test.js
 * 
 * Setup: jest + jest-chrome
 * Run: npx jest tests/unit/store.test.js
 */

// Mock chrome.runtime.sendMessage
const mockSendMessage = jest.fn();
global.chrome = {
    runtime: { sendMessage: mockSendMessage }
};

// Must re-import after mock setup
let store;
beforeEach(async () => {
    jest.resetModules();
    mockSendMessage.mockClear();
    store = await import('../../entrypoints/dashboard/store.js');
    // Reset to clean state between tests
    store.setAppData({ folders: [], chats: [] });
});

// ── addFolder ────────────────────────────────────────────────

test('addFolder creates folder with UUID and correct parentId', () => {
    const f = store.addFolder("Research", null);
    expect(f.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.parentId).toBeNull();
    expect(f.name).toBe("Research");
    expect(store.getAppData().folders).toHaveLength(1);
});

test('addFolder calls sync (sendMessage SAVE_TO_DISK)', () => {
    store.addFolder("Test", null);
    expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SAVE_TO_DISK" })
    );
});

// ── deleteFolder (recursion) ─────────────────────────────────

test('deleteFolder removes only target folder when no children', () => {
    const f = store.addFolder("Leaf", null);
    store.deleteFolder(f.id);
    expect(store.getAppData().folders).toHaveLength(0);
});

test('deleteFolder recursively removes all descendant folders', () => {
    const root  = store.addFolder("Root", null);
    const child = store.addFolder("Child", root.id);
    const grand = store.addFolder("Grand", child.id);

    store.deleteFolder(root.id);
    expect(store.getAppData().folders).toHaveLength(0);
});

test('deleteFolder removes all descendant chats', () => {
    const root  = store.addFolder("Root", null);
    const child = store.addFolder("Child", root.id);
    store.addChat("Chat 1", root.id);
    store.addChat("Chat 2", child.id);

    store.deleteFolder(root.id);
    expect(store.getAppData().chats).toHaveLength(0);
});

test('deleteFolder does not remove unrelated folders', () => {
    const a = store.addFolder("A", null);
    const b = store.addFolder("B", null);
    store.deleteFolder(a.id);
    expect(store.getAppData().folders.find(f => f.id === b.id)).toBeTruthy();
});

// ── updateChat ───────────────────────────────────────────────

test('updateChat merges patch without overwriting other fields', () => {
    const f = store.addFolder("P", null);
    const c = store.addChat("Chat", f.id);
    store.updateChat(c.id, { notes: "hello" });

    const updated = store.getAppData().chats.find(x => x.id === c.id);
    expect(updated.notes).toBe("hello");
    expect(updated.name).toBe("Chat"); // unchanged
    expect(updated.url).toBe("");      // unchanged default
});

test('updateChat calls sync', () => {
    const f = store.addFolder("P", null);
    const c = store.addChat("Chat", f.id);
    mockSendMessage.mockClear();
    store.updateChat(c.id, { content: "text" });
    expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SAVE_TO_DISK" })
    );
});

// ── setAppData ───────────────────────────────────────────────

test('setAppData initialises missing arrays', () => {
    store.setAppData({});
    expect(store.getAppData().folders).toEqual([]);
    expect(store.getAppData().chats).toEqual([]);
});
