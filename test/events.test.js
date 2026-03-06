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

    test('folderTree click on node-content selects item and renders view', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const nodeContent = document.querySelector('.node-content[data-type="folder"]');
        expect(nodeContent).not.toBeNull();
        nodeContent.click();

        // After clicking, contentView should be visible with folder info
        const contentView = document.getElementById('contentView');
        expect(contentView.style.display).toBe('flex');
        expect(contentView.innerHTML).toContain('Test Folder');
    });

    test('chevron toggle expands and collapses folder', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const chevron = document.querySelector('.btn-chevron:not(.invisible)');
        expect(chevron).not.toBeNull();

        const id = chevron.dataset.id;
        const expanded = store.getExpandedFolders();
        const wasExpanded = expanded.has(id);
        chevron.click();
        // After clicking, expanded state should have toggled
        expect(store.getExpandedFolders().has(id)).toBe(!wasExpanded);
    });

    test('edit button renames item when confirmed', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const editBtn = document.querySelector('.btn-edit');
        expect(editBtn).not.toBeNull();

        const id = editBtn.dataset.id;
        global.prompt = jest.fn(() => 'Renamed Item');
        editBtn.click();

        expect(global.prompt).toHaveBeenCalledWith('Rename to:', expect.any(String));
        // Find the renamed item
        const allItems = [...store.getAppData().folders, ...store.getAppData().chats];
        const item = allItems.find(x => x.id === id);
        expect(item.name).toBe('Renamed Item');
    });

    test('delete button prompts confirmation and deletes when confirmed', () => {
        initEvents();
        const renderTree = require('../entrypoints/dashboard/tree.js').renderTree;
        renderTree();

        const deleteBtn = document.querySelector('.btn-delete');
        expect(deleteBtn).not.toBeNull();

        // First: cancel deletion
        global.confirm = jest.fn(() => false);
        const id = deleteBtn.dataset.id;
        deleteBtn.click();
        expect(global.confirm).toHaveBeenCalledWith('Delete permanently?');

        // Item should still exist
        const allItems = [...store.getAppData().folders, ...store.getAppData().chats];
        expect(allItems.find(x => x.id === id)).toBeTruthy();
    });

    test('select chat populates URL and renders messages', () => {
        initEvents();

        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const urlInput = document.getElementById('urlInput');
        expect(urlInput).not.toBeNull();
        expect(urlInput.value).toBe('https://gemini.google.com/test');

        // Check messages rendered
        const contentArea = document.getElementById('chatContentArea');
        expect(contentArea).not.toBeNull();
        expect(contentArea.querySelectorAll('.msg-bubble').length).toBe(2);
    });

    test('sync button sends TRIGGER_EXTRACT message', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const syncBtn = document.getElementById('btnFetchContent');
        expect(syncBtn).not.toBeNull();

        const spy = jest.spyOn(chrome.runtime, 'sendMessage');
        syncBtn.click();

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'TRIGGER_EXTRACT', url: 'https://gemini.google.com/test' }),
            expect.any(Function)
        );
        spy.mockRestore();
    });

    test('send message textarea and button', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const sendInput = document.getElementById('sendMessageInput');
        const sendBtn = document.getElementById('btnSendMessage');
        const spy = jest.spyOn(chrome.runtime, 'sendMessage');

        expect(sendInput).not.toBeNull();
        expect(sendBtn).not.toBeNull();
        expect(sendInput.tagName).toBe('TEXTAREA');
        sendInput.value = 'test textarea message';
        sendBtn.click();
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SEND_ONLY',
            text: 'test textarea message'
        }), expect.any(Function));
        spy.mockRestore();
    });

    test('copy message button click copies text', async () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const mockClipboard = {
            writeText: jest.fn().mockResolvedValue()
        };
        Object.assign(navigator, {
            clipboard: mockClipboard
        });

        const copyBtns = document.querySelectorAll('.btn-copy-msg');
        expect(copyBtns.length).toBeGreaterThan(0);

        copyBtns[0].click();

        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hi');
    });

    test('URL input change triggers updateChat via input event', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const urlInput = document.getElementById('urlInput');
        expect(urlInput).not.toBeNull();

        urlInput.value = 'https://new-url.com';
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Verify the chat URL was updated in store
        const chat = store.getAppData().chats.find(c => c.id === 'c1');
        expect(chat.url).toBe('https://new-url.com');
    });

    test('chatNotes input triggers updateChat', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const notesEl = document.getElementById('chatNotes');
        expect(notesEl).not.toBeNull();

        notesEl.value = 'Updated notes';
        notesEl.dispatchEvent(new Event('input', { bubbles: true }));

        const chat = store.getAppData().chats.find(c => c.id === 'c1');
        expect(chat.notes).toBe('Updated notes');
    });

    test('toggle right panel button toggles class', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const toggleBtn = document.getElementById('toggleRightPanel');
        expect(toggleBtn).not.toBeNull();

        const appShell = document.getElementById('appShell');
        const wasOpen = appShell.classList.contains('right-open');
        toggleBtn.click();
        expect(appShell.classList.contains('right-open')).toBe(!wasOpen);
    });

    test('Enter key in textarea sends message, Shift+Enter does not', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        const sendInput = document.getElementById('sendMessageInput');
        expect(sendInput).not.toBeNull();
        sendInput.value = 'enter test';

        const spy = jest.spyOn(chrome.runtime, 'sendMessage');

        // Shift+Enter should NOT send
        sendInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', shiftKey: true, bubbles: true
        }));
        expect(spy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SEND_ONLY' }),
            expect.any(Function)
        );

        // Enter alone should send
        sendInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', shiftKey: false, bubbles: true
        }));
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SEND_ONLY', text: 'enter test' }),
            expect.any(Function)
        );
        spy.mockRestore();
    });

    test('does not show "Switch back to REXOW" button after send flow (removed feature)', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true
        });

        chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
            if (msg.type === 'SEND_ONLY') {
                cb?.({ status: 'success', sent: true });
                return;
            }
            if (msg.type === 'WAIT_AND_EXTRACT') {
                cb?.({
                    status: 'success',
                    data: {
                        content: 'assistant response',
                        platform: 'gemini',
                        messages: [
                            { role: 'user', text: 'Q' },
                            { role: 'assistant', text: 'A' }
                        ]
                    }
                });
                return;
            }
            cb?.({ status: 'success' });
        });

        const sendInput = document.getElementById('sendMessageInput');
        const sendBtn = document.getElementById('btnSendMessage');
        expect(sendInput).not.toBeNull();
        expect(sendBtn).not.toBeNull();

        sendInput.value = 'test hidden flow';
        sendBtn.click();

        // "Switch back to REXOW" button was removed — should never appear
        expect(document.getElementById('btnSwitchToRexow')).toBeNull();
    });

    test('does not show "Switch back to REXOW" button when document is visible', () => {
        initEvents();
        const view = require('../entrypoints/dashboard/view.js');
        view.selectItem('c1', 'chat');

        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true
        });

        chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
            if (msg.type === 'SEND_ONLY') {
                cb?.({ status: 'success', sent: true });
                return;
            }
            if (msg.type === 'WAIT_AND_EXTRACT') {
                cb?.({
                    status: 'success',
                    data: {
                        content: 'assistant response',
                        platform: 'gemini',
                        messages: [
                            { role: 'user', text: 'Q' },
                            { role: 'assistant', text: 'A' }
                        ]
                    }
                });
                return;
            }
            cb?.({ status: 'success' });
        });

        const sendInput = document.getElementById('sendMessageInput');
        const sendBtn = document.getElementById('btnSendMessage');
        expect(sendInput).not.toBeNull();
        expect(sendBtn).not.toBeNull();

        sendInput.value = 'test visible flow';
        sendBtn.click();

        expect(document.getElementById('btnSwitchToRexow')).toBeNull();
    });
});
