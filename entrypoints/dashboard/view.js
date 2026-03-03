/**
 * view.js — Main Workspace View Rendering
 */
import { getAppData, setCurrentId, getExpandedFolders } from './store.js';
import { assignColors, getColor } from './colors.js';
import { Icons } from './icons.js';
import { renderTree } from './tree.js';
import { renderMarkdown } from './markdown.js';

export function renderMainView(id, type) {
    const container = document.getElementById('contentView');
    const welcome = document.getElementById('welcomeScreen');
    const appShell = document.getElementById('appShell');

    welcome.style.display = 'none';
    container.style.display = 'flex';

    if (type === 'folder') {
        appShell.classList.remove('right-open');
        const folder = getAppData().folders.find(f => f.id === id);
        if (folder) renderFolderView(folder);
    } else {
        appShell.classList.add('right-open');
        const chat = getAppData().chats.find(c => c.id === id);
        if (chat) renderChatView(chat);
    }
}

export function renderFolderView(folder) {
    const container = document.getElementById('contentView');
    const { folders, chats } = getAppData();

    const subFolders = folders.filter(f => f.parentId === folder.id);
    const subChats = chats.filter(c => c.parentId === folder.id);

    let gridHtml = '';
    subFolders.forEach(f => {
        gridHtml += `<div class="grid-item" data-id="${f.id}" data-type="folder">${Icons.folder(getColor(f.id))}<span>${f.name}</span></div>`;
    });
    subChats.forEach(c => {
        gridHtml += `<div class="grid-item" data-id="${c.id}" data-type="chat">${Icons.file(getColor(c.id))}<span>${c.name}</span></div>`;
    });

    container.innerHTML = `
    <div class="folder-dashboard">
    <div class="folder-header">
    ${Icons.folder(getColor(folder.id))}
    <h1>${folder.name}</h1>
    </div>
    <div class="panel-section">
    <label>FOLDER NOTES</label>
    <textarea id="mainNoteEditor" class="glass-input">${folder.notes || ''}</textarea>
    </div>
    <div class="panel-section">
    <label>CONTENTS</label>
    <div class="folder-grid">
    ${gridHtml || '<span style="color:#666; font-style:italic; padding:12px;">Empty folder</span>'}
    </div>
    </div>
    </div>`;
}

export function renderChatView(chat) {
    const container = document.getElementById('contentView');

    container.innerHTML = `
    <div class="chat-wrapper">
    <div class="chat-header-bar">
    <span id="chatTitleDisplay" style="font-weight:600; font-size:15px;">${chat.name}</span>
    <button id="toggleRightPanel" class="btn-toggle-rotate" title="Toggle Notes Panel">
    ${Icons.close}
    </button>
    </div>

    <div class="chat-url-bar">
    <input
    id="urlInput"
    type="url"
    placeholder="Paste AI conversation URL..."
    value="${chat.url || ''}"
    />
    <button id="btnOpenUrl" class="btn-open-url" title="Open in new tab">OPEN</button>
    <button id="btnFetchContent" class="btn-xs">SYNC CONTENT</button>
    </div>

    <div id="chatContentArea">
    ${renderMessagesHtml(chat.messages, chat.content)}
    </div>

    <div class="chat-send-bar">
    <input id="sendMessageInput" type="text" placeholder="Type a message to send to AI..." autocomplete="off" />
    <button id="btnSendMessage" class="btn-send" title="Send message">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
    </button>
    </div>
    </div>`;

    // Scroll to bottom so newest messages are visible
    requestAnimationFrame(() => {
        const chatArea = document.getElementById('chatContentArea');
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
    });

    // Populate right panel
    const notesEl = document.getElementById('chatNotes');
    const summaryEl = document.getElementById('summaryDisplay');
    if (notesEl) notesEl.value = chat.notes || '';
    if (summaryEl) summaryEl.innerHTML = chat.summary || 'No summary generated.';
}

function renderMessagesHtml(messages, content) {
    if (messages && messages.length > 0) {
        return messages.map(m => {
            const roleClass = (m.role === 'user') ? 'msg-user' : 'msg-assistant';
            // Use renderMarkdown for assistant messages, escape user text
            const htmlContent = m.role === 'user'
                ? `<div style="white-space: pre-wrap;">${(m.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
                : `<div class="markdown-body">${renderMarkdown(m.text || '')}</div>`;
            return `
            <div class="msg-bubble ${roleClass}">
            <div class="msg-role">${(m.role || 'unknown').toUpperCase()}</div>
            <div class="msg-text">${htmlContent}</div>
            </div>`;
        }).join('');
    }
    if (content && content.trim()) {
        return `<div class="content-raw markdown-body">${renderMarkdown(content)}</div>`;
    }
    return `<div style="text-align:center; padding:40px; color:var(--text-muted);">
    <p>No content synced yet.</p>
    <p style="font-size:12px;">Paste a URL above and click SYNC CONTENT.</p>
    </div>`;
}

export function showWelcome() {
    setCurrentId(null);
    document.documentElement.style.setProperty('--active-color', '#ec4899');
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.getElementById('contentView').style.display = 'none';
    document.getElementById('appShell').classList.remove('right-open');
}

export function updateSummaryDisplay(html) {
    const el = document.getElementById('summaryDisplay');
    if (el) el.innerHTML = html;
}

export function selectItem(id, type) {
    setCurrentId(id);
    assignColors(getAppData());
    document.documentElement.style.setProperty('--active-color', getColor(id));

    if (type === 'folder') {
        getExpandedFolders().add(id);
    }

    renderMainView(id, type);
    renderTree();

    requestAnimationFrame(() => {
        const activeNode = document.querySelector('.node-content.active');
        if (activeNode) activeNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
}
