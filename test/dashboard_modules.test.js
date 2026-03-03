/**
 * dashboard_modules.test.js — Tests for colors, icons, tree, view, markdown, store
 */

// ── Colors ────────────────────────────────────────────────────

describe('colors.js', () => {
    let assignColors, getColor;

    beforeAll(() => {
        const mod = require('../entrypoints/dashboard/colors.js');
        assignColors = mod.assignColors;
        getColor = mod.getColor;
    });

    test('assignColors assigns colors to all nodes', () => {
        const appData = {
            folders: [
                { id: 'f1', name: 'Folder 1', parentId: null },
                { id: 'f2', name: 'Folder 2', parentId: null }
            ],
            chats: [
                { id: 'c1', name: 'Chat 1', parentId: 'f1' }
            ]
        };
        const map = assignColors(appData);
        expect(map['f1']).toBeDefined();
        expect(map['f2']).toBeDefined();
        expect(map['c1']).toBeDefined();
    });

    test('siblings get different colors', () => {
        const appData = {
            folders: [
                { id: 'a', name: 'A', parentId: null },
                { id: 'b', name: 'B', parentId: null }
            ],
            chats: []
        };
        const map = assignColors(appData);
        expect(map['a']).not.toBe(map['b']);
    });

    test('getColor returns fallback for unknown ID', () => {
        assignColors({ folders: [], chats: [] });
        expect(getColor('nonexistent')).toBe('#fff');
    });

    test('handles deeply nested structure', () => {
        const appData = {
            folders: [
                { id: 'f1', name: 'Root', parentId: null },
                { id: 'f2', name: 'Child', parentId: 'f1' },
                { id: 'f3', name: 'GrandChild', parentId: 'f2' }
            ],
            chats: [
                { id: 'c1', name: 'Deep Chat', parentId: 'f3' }
            ]
        };
        const map = assignColors(appData);
        expect(map['f1']).toBeDefined();
        expect(map['f3']).toBeDefined();
        expect(map['c1']).toBeDefined();
    });

    test('handles empty app data', () => {
        const map = assignColors({ folders: [], chats: [] });
        expect(Object.keys(map).length).toBe(0);
    });

    test('handles more siblings than palette colors', () => {
        const folders = [];
        for (let i = 0; i < 15; i++) {
            folders.push({ id: `f${i}`, name: `Folder ${i}`, parentId: null });
        }
        const map = assignColors({ folders, chats: [] });
        // All 15 should have colors assigned
        for (let i = 0; i < 15; i++) {
            expect(map[`f${i}`]).toBeDefined();
        }
    });
});

// ── Icons ─────────────────────────────────────────────────────

describe('icons.js', () => {
    let Icons;

    beforeAll(() => {
        Icons = require('../entrypoints/dashboard/icons.js').Icons;
    });

    test('folder returns SVG with given color', () => {
        const svg = Icons.folder('#ff0000');
        expect(svg).toContain('stroke:#ff0000');
        expect(svg).toContain('svg');
    });

    test('file returns SVG with given color', () => {
        const svg = Icons.file('#00ff00');
        expect(svg).toContain('stroke:#00ff00');
        expect(svg).toContain('svg');
    });

    test('all static icons are strings', () => {
        expect(typeof Icons.addFolder).toBe('string');
        expect(typeof Icons.addFile).toBe('string');
        expect(typeof Icons.edit).toBe('string');
        expect(typeof Icons.trash).toBe('string');
        expect(typeof Icons.close).toBe('string');
        expect(typeof Icons.chevronRight).toBe('string');
    });

    test('all icons contain svg elements', () => {
        expect(Icons.addFolder).toContain('<svg');
        expect(Icons.edit).toContain('<svg');
        expect(Icons.trash).toContain('<svg');
    });
});

// ── Markdown ──────────────────────────────────────────────────

describe('markdown.js', () => {
    let renderMarkdown;

    beforeAll(() => {
        // Mock global marked as a simple passthrough
        global.marked = {
            parse: jest.fn((text) => `<p>${text}</p>`),
            use: jest.fn()
        };
        global.markedKatex = jest.fn(() => ({}));

        const mod = require('../entrypoints/dashboard/markdown.js');
        renderMarkdown = mod.renderMarkdown;
    });

    afterAll(() => {
        delete global.marked;
        delete global.markedKatex;
    });

    test('returns empty string for falsy input', () => {
        expect(renderMarkdown('')).toBe('');
        expect(renderMarkdown(null)).toBe('');
        expect(renderMarkdown(undefined)).toBe('');
    });

    test('returns empty string for non-string input', () => {
        expect(renderMarkdown(123)).toBe('');
        expect(renderMarkdown({})).toBe('');
    });

    test('renders text through marked when available', () => {
        const result = renderMarkdown('Hello world');
        expect(result).toContain('Hello world');
    });

    test('calls marked.parse for rendering', () => {
        renderMarkdown('test');
        expect(global.marked.parse).toHaveBeenCalledWith('test');
    });

    test('handles error gracefully', () => {
        global.marked.parse.mockImplementationOnce(() => { throw new Error('Parse error'); });
        const result = renderMarkdown('<script>alert("xss")</script>');
        // Should return escaped text
        expect(result).toContain('&lt;script&gt;');
    });
});

// ── Store extended ────────────────────────────────────────────

describe('store.js extended', () => {
    let store;

    beforeEach(() => {
        jest.resetModules();

        // Mock chrome APIs
        global.chrome = {
            runtime: {
                connect: jest.fn(() => ({
                    onMessage: { addListener: jest.fn() },
                    onDisconnect: { addListener: jest.fn() },
                    postMessage: jest.fn()
                })),
                sendMessage: jest.fn((msg, cb) => { if (cb) cb({}); }),
                lastError: null
            }
        };

        store = require('../entrypoints/dashboard/store.js');
    });

    test('setAppData rejects invalid data', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation();
        store.setAppData(null);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('setAppData normalizes missing arrays', () => {
        store.setAppData({});
        const data = store.getAppData();
        expect(Array.isArray(data.folders)).toBe(true);
        expect(Array.isArray(data.chats)).toBe(true);
    });

    test('addFolder creates folder with correct shape', () => {
        store.setAppData({ folders: [], chats: [] });
        const folder = store.addFolder('Test', null);
        expect(folder.name).toBe('Test');
        expect(folder.parentId).toBeNull();
        expect(folder.id).toBeDefined();
        expect(folder.notes).toBe('');
    });

    test('addFolder trims name', () => {
        store.setAppData({ folders: [], chats: [] });
        const folder = store.addFolder('  Spaced  ', null);
        expect(folder.name).toBe('Spaced');
    });

    test('addFolder throws on empty name', () => {
        store.setAppData({ folders: [], chats: [] });
        expect(() => store.addFolder('', null)).toThrow();
        expect(() => store.addFolder('   ', null)).toThrow();
    });

    test('addChat creates chat with correct shape', () => {
        store.setAppData({ folders: [], chats: [] });
        const chat = store.addChat('Chat 1', 'parent-id');
        expect(chat.name).toBe('Chat 1');
        expect(chat.parentId).toBe('parent-id');
        expect(chat.url).toBe('');
        expect(chat.messages).toEqual([]);
    });

    test('addChat throws without parent', () => {
        store.setAppData({ folders: [], chats: [] });
        expect(() => store.addChat('Chat', null)).toThrow('must belong');
    });

    test('addChat throws on empty name', () => {
        store.setAppData({ folders: [], chats: [] });
        expect(() => store.addChat('', 'p1')).toThrow();
    });

    test('updateFolder updates existing folder', () => {
        store.setAppData({ folders: [{ id: 'f1', name: 'Old', parentId: null, notes: '' }], chats: [] });
        store.updateFolder('f1', { name: 'New' });
        const data = store.getAppData();
        expect(data.folders[0].name).toBe('New');
    });

    test('updateFolder handles non-existent folder', () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation();
        store.setAppData({ folders: [], chats: [] });
        store.updateFolder('xyz', { name: 'test' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('updateFolder skips when id is falsy', () => {
        store.setAppData({ folders: [], chats: [] });
        store.updateFolder(null, { name: 'test' }); // Should not throw
    });

    test('updateChat updates existing chat', () => {
        store.setAppData({
            folders: [],
            chats: [{ id: 'c1', name: 'Old', parentId: 'p1', url: '', content: '', messages: [] }]
        });
        store.updateChat('c1', { name: 'Updated', url: 'https://test.com' });
        const data = store.getAppData();
        expect(data.chats[0].name).toBe('Updated');
        expect(data.chats[0].url).toBe('https://test.com');
    });

    test('updateChat handles non-existent chat', () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation();
        store.setAppData({ folders: [], chats: [] });
        store.updateChat('xyz', { name: 'test' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('deleteChat removes chat', () => {
        store.setAppData({
            folders: [],
            chats: [
                { id: 'c1', name: 'Chat 1', parentId: 'p' },
                { id: 'c2', name: 'Chat 2', parentId: 'p' }
            ]
        });
        store.deleteChat('c1');
        const data = store.getAppData();
        expect(data.chats.length).toBe(1);
        expect(data.chats[0].id).toBe('c2');
    });

    test('deleteFolder cascades to children', () => {
        store.setAppData({
            folders: [
                { id: 'f1', name: 'Root', parentId: null },
                { id: 'f2', name: 'Child', parentId: 'f1' }
            ],
            chats: [
                { id: 'c1', name: 'Chat in child', parentId: 'f2' },
                { id: 'c2', name: 'Unrelated chat', parentId: 'other' }
            ]
        });
        store.deleteFolder('f1');
        const data = store.getAppData();
        expect(data.folders.length).toBe(0);
        expect(data.chats.length).toBe(1);
        expect(data.chats[0].id).toBe('c2');
    });

    test('deleteFolder handles null id', () => {
        store.setAppData({ folders: [{ id: 'f1', name: 'A', parentId: null }], chats: [] });
        store.deleteFolder(null);
        expect(store.getAppData().folders.length).toBe(1);
    });

    test('setCurrentId and getCurrentId', () => {
        store.setCurrentId('test-id');
        expect(store.getCurrentId()).toBe('test-id');
    });

    test('getExpandedFolders returns a Set', () => {
        expect(store.getExpandedFolders()).toBeInstanceOf(Set);
    });

    test('initPort creates a connection', () => {
        const callback = jest.fn();
        store.initPort(callback);
        expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'dashboard' });
    });

    test('sync sends SAVE_TO_DISK message', () => {
        store.setAppData({ folders: [], chats: [] });
        store.sync();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_TO_DISK' }),
            expect.any(Function)
        );
    });
});

// ── Tree ──────────────────────────────────────────────────────

describe('tree.js', () => {
    let renderTree;

    beforeEach(() => {
        jest.resetModules();

        global.chrome = {
            runtime: {
                connect: jest.fn(() => ({
                    onMessage: { addListener: jest.fn() },
                    onDisconnect: { addListener: jest.fn() },
                    postMessage: jest.fn()
                })),
                sendMessage: jest.fn(),
                lastError: null
            }
        };

        document.body.innerHTML = '<nav id="folderTree"></nav>';

        const store = require('../entrypoints/dashboard/store.js');
        store.setAppData({
            folders: [
                { id: 'f1', name: 'Project 1', parentId: null },
                { id: 'f2', name: 'Sub Folder', parentId: 'f1' }
            ],
            chats: [
                { id: 'c1', name: 'Chat A', parentId: 'f1' }
            ]
        });

        renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
    });

    test('renders tree into folderTree container', () => {
        renderTree();
        const container = document.getElementById('folderTree');
        expect(container.innerHTML).not.toBe('');
        expect(container.querySelector('ul')).not.toBeNull();
    });

    test('renders folder nodes', () => {
        renderTree();
        const nodes = document.querySelectorAll('.tree-node');
        expect(nodes.length).toBeGreaterThanOrEqual(1);
    });

    test('renders node names', () => {
        renderTree();
        const names = document.querySelectorAll('.node-name');
        const texts = Array.from(names).map(n => n.textContent);
        expect(texts).toContain('Project 1');
    });

    test('handles missing container gracefully', () => {
        document.body.innerHTML = '';
        expect(() => renderTree()).not.toThrow();
    });

    test('renders empty tree when no data', () => {
        const store = require('../entrypoints/dashboard/store.js');
        store.setAppData({ folders: [], chats: [] });
        renderTree();
        const container = document.getElementById('folderTree');
        // Should be empty (no nodes)
        expect(container.innerHTML).toBe('');
    });
});

// ── View ──────────────────────────────────────────────────────

describe('view.js', () => {
    let renderMainView, showWelcome, selectItem, updateSummaryDisplay;

    beforeEach(() => {
        jest.resetModules();

        global.chrome = {
            runtime: {
                connect: jest.fn(() => ({
                    onMessage: { addListener: jest.fn() },
                    onDisconnect: { addListener: jest.fn() },
                    postMessage: jest.fn()
                })),
                sendMessage: jest.fn(),
                lastError: null
            }
        };

        document.body.innerHTML = `
            <div class="app-shell" id="appShell">
                <div id="welcomeScreen" style="display:flex;"></div>
                <div id="contentView" style="display:none;"></div>
                <nav id="folderTree"></nav>
                <textarea id="chatNotes"></textarea>
                <div id="summaryDisplay"></div>
            </div>
        `;

        const store = require('../entrypoints/dashboard/store.js');
        store.setAppData({
            folders: [{ id: 'f1', name: 'Test Folder', parentId: null, notes: 'Some notes' }],
            chats: [{ id: 'c1', name: 'Test Chat', parentId: 'f1', url: 'https://test.com', content: 'test content', messages: [], notes: 'chat notes', summary: 'summary text' }]
        });

        const view = require('../entrypoints/dashboard/view.js');
        renderMainView = view.renderMainView;
        showWelcome = view.showWelcome;
        selectItem = view.selectItem;
        updateSummaryDisplay = view.updateSummaryDisplay;
    });

    test('renderMainView shows folder view', () => {
        renderMainView('f1', 'folder');
        const content = document.getElementById('contentView');
        expect(content.style.display).toBe('flex');
        expect(content.innerHTML).toContain('Test Folder');
    });

    test('renderMainView shows chat view', () => {
        renderMainView('c1', 'chat');
        const content = document.getElementById('contentView');
        expect(content.style.display).toBe('flex');
        expect(content.innerHTML).toContain('Test Chat');
    });

    test('showWelcome hides content and shows welcome', () => {
        showWelcome();
        expect(document.getElementById('welcomeScreen').style.display).toBe('flex');
        expect(document.getElementById('contentView').style.display).toBe('none');
    });

    test('updateSummaryDisplay sets innerHTML', () => {
        updateSummaryDisplay('<strong>Test</strong>');
        expect(document.getElementById('summaryDisplay').innerHTML).toBe('<strong>Test</strong>');
    });

    test('selectItem renders view and updates tree', () => {
        selectItem('f1', 'folder');
        const content = document.getElementById('contentView');
        expect(content.innerHTML).toContain('Test Folder');
    });

    test('renderMainView handles missing folder gracefully', () => {
        expect(() => renderMainView('nonexistent', 'folder')).not.toThrow();
    });

    test('renderMainView handles missing chat gracefully', () => {
        expect(() => renderMainView('nonexistent', 'chat')).not.toThrow();
    });
});

// ── Init ──────────────────────────────────────────────────────

describe('init.js', () => {
    let initBackground;

    beforeAll(() => {
        initBackground = require('../entrypoints/dashboard/init.js').initBackground;
    });

    test('initBackground is a function', () => {
        expect(typeof initBackground).toBe('function');
    });

    test('initBackground does not throw', () => {
        expect(() => initBackground()).not.toThrow();
    });
});
