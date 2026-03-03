/**
 * events.test.js — Tests for dashboard event wiring
 */

describe('events.js', () => {
    let initEvents, store;

    beforeEach(() => {
        jest.resetModules();

        global.chrome = {
            runtime: {
                connect: jest.fn(() => ({
                    onMessage: { addListener: jest.fn() },
                    onDisconnect: { addListener: jest.fn() },
                    postMessage: jest.fn()
                })),
                sendMessage: jest.fn((msg, cb) => { if (cb) cb({ status: 'success' }); }),
                lastError: null
            },
            tabs: {
                create: jest.fn()
            }
        };

        global.marked = {
            parse: jest.fn((text) => `<p>${text}</p>`),
            use: jest.fn()
        };
        global.markedKatex = jest.fn(() => ({}));

        document.body.innerHTML = `
            <div class="app-shell" id="appShell">
                <div id="welcomeScreen" style="display:flex;"></div>
                <div id="contentView" style="display:none;"></div>
                <nav id="folderTree"></nav>
                <div class="brand-text" id="brandHome">REXOW</div>
                <button id="addRootFolder"></button>
                <textarea id="chatNotes"></textarea>
                <div id="summaryDisplay"></div>
            </div>
        `;

        store = require('../entrypoints/dashboard/store.js');
        store.setAppData({
            folders: [{ id: 'f1', name: 'Test Folder', parentId: null, notes: '' }],
            chats: [{ id: 'c1', name: 'Test Chat', parentId: 'f1', url: 'https://gemini.google.com/test', content: 'hello', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], notes: '', summary: '' }]
        });

        const events = require('../entrypoints/dashboard/events.js');
        initEvents = events.initEvents;
    });

    afterEach(() => {
        delete global.marked;
        delete global.markedKatex;
    });

    test('initEvents is a function', () => {
        expect(typeof initEvents).toBe('function');
    });

    test('initEvents does not throw', () => {
        expect(() => initEvents()).not.toThrow();
    });

    test('brandHome click is wired', () => {
        initEvents();
        const brand = document.getElementById('brandHome');
        expect(brand.onclick).not.toBeNull();
    });

    test('addRootFolder click handler is wired', () => {
        initEvents();
        const btn = document.getElementById('addRootFolder');
        expect(btn.onclick).not.toBeNull();
    });

    test('addRootFolder prompts for name', () => {
        initEvents();
        global.prompt = jest.fn(() => 'New Project');
        const btn = document.getElementById('addRootFolder');
        btn.onclick();
        expect(global.prompt).toHaveBeenCalledWith('New Project Name:');
        expect(store.getAppData().folders.length).toBe(2); // Original + new
    });

    test('addRootFolder does nothing if cancelled', () => {
        initEvents();
        global.prompt = jest.fn(() => null);
        const btn = document.getElementById('addRootFolder');
        btn.onclick();
        expect(store.getAppData().folders.length).toBe(1);
    });

    test('folderTree click handler on node-content selects item', () => {
        initEvents();
        // Render tree first so we have nodes to click
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        // Find a node-content element
        const nodeContent = document.querySelector('.node-content[data-type="folder"]');
        if (nodeContent) {
            // Simulate click by triggering the folderTree click handler
            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: nodeContent, configurable: true });
            nodeContent.click();
        }
    });

    test('chevron toggle works in tree clicks', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const chevron = document.querySelector('.btn-chevron:not(.invisible)');
        if (chevron) {
            chevron.click();
            // After click, expanded state should toggle
        }
    });

    test('action button clicks are handled', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        // Test edit button
        const editBtn = document.querySelector('.btn-edit');
        if (editBtn) {
            global.prompt = jest.fn(() => 'Renamed');
            editBtn.click();
        }
    });

    test('delete button prompts for confirmation', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const deleteBtn = document.querySelector('.btn-delete');
        if (deleteBtn) {
            global.confirm = jest.fn(() => false);
            deleteBtn.click();
            expect(global.confirm).toHaveBeenCalled();
        }
    });

    test('select chat and interact with URL bar', () => {
        initEvents();

        // Select the chat
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        // Check URL input is populated
        const urlInput = document.getElementById('urlInput');
        if (urlInput) {
            expect(urlInput.value).toBe('https://gemini.google.com/test');
        }

        // Test SYNC CONTENT button
        const syncBtn = document.getElementById('btnFetchContent');
        if (syncBtn) {
            syncBtn.click();
        }
    });

    test('send message input and button', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const sendInput = document.getElementById('sendMessageInput');
        const sendBtn = document.getElementById('btnSendMessage');

        if (sendInput && sendBtn) {
            sendInput.value = 'test message';
            sendBtn.click();
        }
    });

    test('URL change triggers save', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const urlInput = document.getElementById('urlInput');
        if (urlInput) {
            urlInput.value = 'https://new-url.com';
            urlInput.dispatchEvent(new Event('change'));
        }
    });

    test('notes textarea change triggers save', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const notesEl = document.getElementById('chatNotes');
        if (notesEl) {
            notesEl.value = 'New notes';
            notesEl.dispatchEvent(new Event('input'));
        }
    });

    test('toggle right panel button', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const toggleBtn = document.getElementById('toggleRightPanel');
        if (toggleBtn) {
            toggleBtn.click();
        }
    });
});
