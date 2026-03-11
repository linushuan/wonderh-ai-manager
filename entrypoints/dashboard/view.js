/**
 * view.js — Main Workspace View Rendering
 */
import { getAppData, setCurrentId, getExpandedFolders } from './store.js';
import { assignColors, getColor } from './colors.js';
import { Icons } from './icons.js';
import { renderTree } from './tree.js';
import { renderMarkdown } from './markdown.js';

/** Escape HTML special chars to prevent XSS when interpolating into innerHTML */
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
        gridHtml += `<div class="grid-item" data-id="${esc(f.id)}" data-type="folder">${Icons.folder(getColor(f.id))}<span>${esc(f.name)}</span></div>`;
    });
    subChats.forEach(c => {
        gridHtml += `<div class="grid-item" data-id="${esc(c.id)}" data-type="chat">${Icons.file(getColor(c.id))}<span>${esc(c.name)}</span></div>`;
    });

    container.innerHTML = `
    <div class="folder-dashboard">
    <div class="folder-header">
    ${Icons.folder(getColor(folder.id))}
    <h1>${esc(folder.name)}</h1>
    </div>
    <div class="panel-section">
    <label>FOLDER NOTES</label>
    <textarea id="mainNoteEditor" class="glass-input">${esc(folder.notes)}</textarea>
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
    <span id="chatTitleDisplay" style="font-weight:600; font-size:15px;">${esc(chat.name)}</span>
    <button id="toggleRightPanel" class="btn-toggle-rotate" title="Toggle Notes Panel">
    ${Icons.close}
    </button>
    </div>

    <div class="chat-url-bar">
    <input
    id="urlInput"
    type="url"
    placeholder="Paste AI conversation URL..."
    value="${esc(chat.url)}"
    />
    <button id="btnGoToUrlTab" class="btn-open-url" title="Switch to AI Tab">GO TO CHAT</button>
    <button id="btnOpenUrl" class="btn-xs" title="Open in new tab">OPEN NEW</button>
    <button id="btnFetchContent" class="btn-xs">SYNC CONTENT</button>
    </div>

    <div id="chatContentArea">
    ${renderMessagesHtml(chat.messages, chat.content, chat.url)}
    </div>

    <div id="filePreviewContainer" class="file-preview-container"></div>

    <div class="chat-send-bar">
    <input type="file" id="fileUploadInput" multiple hidden>
    <button id="btnAttachFile" class="btn-attach" title="Attach files" style="display: none;">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
    </button>
    <textarea id="sendMessageInput" rows="2" placeholder="Type a message to send to AI...  (Shift+Enter for new line)" autocomplete="off"></textarea>
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
    if (summaryEl) summaryEl.innerHTML = chat.summary ? esc(chat.summary) : 'No summary generated.';
}

function renderMessagesHtml(messages, content, chatUrl) {
    if (messages && messages.length > 0) {
        return messages.map(m => {
            const roleClass = (m.role === 'user') ? 'msg-user' : 'msg-assistant';
            const rawText = (m.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // Render both user and assistant messages through renderMarkdown
            // so that user-typed LaTeX ($...$, $$...$$) and markdown also renders.
            const htmlContent = renderMarkdown(m.text || '') || `<div style="white-space: pre-wrap;">${rawText}</div>`;
            // Encode raw text for copy button (use base64 to avoid attribute escaping issues)
            const copyData = btoa(unescape(encodeURIComponent(m.text || '')));
            return `
            <div class="msg-bubble ${roleClass}">
            <div class="msg-header">
            <div class="msg-role">${(m.role || 'unknown').toUpperCase()}</div>
            <button class="btn-copy-msg" data-copy="${copyData}" title="Copy message">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            </div>
            <div class="msg-text markdown-body">${htmlContent}</div>
            </div>`;
        }).join('');
    }
    if (content && content.trim()) {
        return `<div class="content-raw markdown-body">${renderMarkdown(content)}</div>`;
    }

    // If there is a URL but no content, show the sync prompt
    if (chatUrl && chatUrl.trim()) {
        return `<div style="text-align:center; padding:40px; color:var(--text-muted);">
        <p>No content synced yet.</p>
        <p style="font-size:12px;">Click SYNC CONTENT to fetch the conversation.</p>
        </div>`;
    }

    // Completely empty chat (no URL, no content) - show AI provider selection
    return `
    <div class="empty-chat-state">
        <div class="empty-chat-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <h2>Start a New Conversation</h2>
        <p>Select an AI assistant to begin a new chat or paste an existing URL above.</p>
        
        <div class="ai-provider-grid">
            <button class="btn-provider provider-chatgpt" data-provider="chatgpt">
                <div class="provider-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A6.0651 6.0651 0 0 0 19.022 19.82a5.9847 5.9847 0 0 0 3.9977-2.9 6.0462 6.0462 0 0 0-.7378-7.0988zm-8.6253 11.229a4.3418 4.3418 0 0 1-3.6053-1.9213l.0673-.0382 5.2536-3.0331a.8804.8804 0 0 0 .4393-.7624v-6.7327l2.2533 1.3009v6.5936a4.4239 4.4239 0 0 1-4.4082 4.5932zm-7.668-3.3283a4.3466 4.3466 0 0 1 .1983-4.085l.0673.0382 5.2536 3.0331c.2538.1466.568.1466.8218 0l5.8306-3.3663v2.6017l-5.7176 3.3008a4.4239 4.4239 0 0 1-6.454-1.5225zm-2.0716-8.991c1.232-2.1337 3.966-2.864 6.0335-1.6146l5.8306 3.3663-2.2533 1.3009-5.7176-3.3008a.8661.8661 0 0 0-.8218 0l-5.2536 3.0331-.0673-.0382a4.4239 4.4239 0 0 1 2.2497-6.0713L3.917 8.7308zm14.156-1.5225c-.2538-.1466-.568-.1466-.8218 0l-5.2536 3.0331-.0673-.0382a4.3466 4.3466 0 0 1-.1983-4.085 4.4239 4.4239 0 0 1 6.454-1.5225l-2.113 3.6126zm3.3331 4.3986c0 2.4544-1.9904 4.4448-4.4448 4.4448v-2.6017l2.2533-1.3009a.8804.8804 0 0 0 .4393-.7624V8.5866l2.113-3.6126c-1.232-2.1337-3.966-2.864-6.0335-1.6146L8.8504 5.0456l2.113 3.6126a4.4239 4.4239 0 0 1 5.9388 4.0957z" /></svg>
                </div>
                <span>ChatGPT</span>
            </button>
            
            <button class="btn-provider provider-claude" data-provider="claude">
                <div class="provider-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 7h2v5.5l4.5 2.5-.75 1.5L11 13V7z"/></svg>
                </div>
                <span>Claude</span>
            </button>
            
            <button class="btn-provider provider-gemini" data-provider="gemini">
                <div class="provider-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12.012 3.682c-.87-.662-2.108-.662-2.98 0l-5.06 3.84c-.458.348-.732.89-.732 1.465v7.68c0 .576.274 1.118.732 1.465l5.06 3.84c.87.662 2.108.662 2.98 0l5.06-3.84c.458-.348.732-.89.732-1.465v-7.68c0-.576-.274-1.118-.732-1.465l-5.06-3.84zm-1.49 10.999H9.418v-5.362h1.104v5.362zm1.61-4.821c-.426 0-.772-.345-.772-.77a.771.771 0 0 1 1.543 0c0 .425-.346.77-.771.77zm1.884 4.82h-1.104v-5.362h1.104v5.362z"/></svg>
                </div>
                <span>Gemini</span>
            </button>
        </div>
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
