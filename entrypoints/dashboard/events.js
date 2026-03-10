/**
 * events.js — Event Delegation & UI Wiring (DEBUG BUILD)
 */
import {
    getAppData, setAppData, getCurrentId, getExpandedFolders,
    addFolder, addChat, updateFolder, updateChat,
    deleteFolder, deleteChat
} from './store.js';
import { selectItem, showWelcome, updateSummaryDisplay, renderMainView } from './view.js';
import { renderTree } from './tree.js';
import { generateSummary, getApiKey } from './api.js';
import { renderMarkdown } from './markdown.js';

/** Escape HTML special chars to prevent XSS when interpolating into innerHTML */
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function initEvents() {

    // ── Brand click → welcome ─────────────────────────────────
    // 注意：DATA_LOADED 現在透過 store.js 的 long-lived port 處理，
    // 不在這裡監聽（Firefox extension page 收不到 runtime.sendMessage 廣播）
    document.getElementById('brandHome').onclick = showWelcome;

    // ── Add root folder ───────────────────────────────────────
    document.getElementById('addRootFolder').onclick = () => {
        const name = prompt("New Project Name:")?.trim();
        if (!name) return;
        try {
            addFolder(name, null);
            renderTree();
        } catch (e) {
            alert("Could not create folder: " + e.message);
        }
    };

    // ── Sidebar tree clicks ───────────────────────────────────
    document.getElementById('folderTree').onclick = (e) => {
        const chevron = e.target.closest('.btn-chevron');
        const btn = e.target.closest('.action-btn');
        const node = e.target.closest('.node-content');

        if (chevron && !chevron.classList.contains('invisible')) {
            e.stopPropagation();
            const id = chevron.dataset.id;
            const expanded = getExpandedFolders();
            expanded.has(id) ? expanded.delete(id) : expanded.add(id);
            renderTree();
            return;
        }

        if (btn) {
            e.stopPropagation();
            const id = btn.dataset.id;
            const type = btn.dataset.type || node?.dataset.type;

            if (btn.classList.contains('btn-add')) {
                const name = prompt("New Folder Name:")?.trim();
                if (!name) return;
                try { addFolder(name, id); renderTree(); }
                catch (e) { alert("Could not create folder: " + e.message); }

            } else if (btn.classList.contains('btn-new-chat')) {
                const name = prompt("New Chat Name:")?.trim();
                if (!name) return;
                try { addChat(name, id); renderTree(); }
                catch (e) { alert("Could not create chat: " + e.message); }

            } else if (btn.classList.contains('btn-edit')) {
                const item = type === 'folder'
                    ? getAppData().folders.find(x => x.id === id)
                    : getAppData().chats.find(x => x.id === id);
                if (!item) return;
                const newName = prompt("Rename to:", item.name)?.trim();
                if (!newName) return;
                try {
                    type === 'folder'
                        ? updateFolder(id, { name: newName })
                        : updateChat(id, { name: newName });
                    renderTree();
                    if (getCurrentId() === id) renderMainView(id, type);
                } catch (e) { alert("Could not rename: " + e.message); }

            } else if (btn.classList.contains('btn-delete')) {
                if (!confirm("Delete permanently?")) return;
                try {
                    type === 'folder' ? deleteFolder(id) : deleteChat(id);
                    showWelcome();
                    renderTree();
                } catch (e) { alert("Could not delete: " + e.message); }
            }
            return;
        }

        if (node) {
            try { selectItem(node.dataset.id, node.dataset.type); }
            catch (e) { console.error("[REXOW events] selectItem failed:", e); }
        }
    };

    // ── Content view grid clicks ──────────────────────────────
    document.getElementById('contentView').onclick = (e) => {
        const gridItem = e.target.closest('.grid-item');
        if (!gridItem) return;
        try { selectItem(gridItem.dataset.id, gridItem.dataset.type); }
        catch (e) { console.error("[REXOW events] grid selectItem failed:", e); }
    };

    // ── Right panel toggle ────────────────────────────────────
    document.getElementById('contentView').addEventListener('click', (e) => {
        const btn = e.target.closest('#toggleRightPanel');
        if (!btn) return;
        const appShell = document.getElementById('appShell');
        const isNowOpen = appShell.classList.toggle('right-open');
        btn.classList.toggle('closed', !isNowOpen);
    });

    // ── Chat view inputs (delegated) ──────────────────────────
    document.getElementById('contentView').addEventListener('input', (e) => {
        const id = getCurrentId();
        if (!id) return;
        if (e.target.id === 'mainNoteEditor') updateFolder(id, { notes: e.target.value });
        if (e.target.id === 'urlInput') updateChat(id, { url: e.target.value });
    });

    // ── SYNC CONTENT button ───────────────────────────────────
    document.getElementById('contentView').addEventListener('click', (e) => {
        if (e.target.id !== 'btnFetchContent') return;

        const id = getCurrentId();
        const chat = getAppData().chats.find(c => c.id === id);
        if (!chat) { console.warn("[REXOW events] SYNC: no active chat"); return; }

        const url = document.getElementById('urlInput')?.value?.trim();
        if (!url) { showSyncError("Please enter a URL first.", ""); return; }
        try { new URL(url); } catch (_) {
            showSyncError("Invalid URL format.", "Make sure the URL starts with https://");
            return;
        }

        updateChat(id, { url });
        const btn = e.target;
        btn.innerText = "Syncing...";
        btn.disabled = true;

        chrome.runtime.sendMessage({ type: "TRIGGER_EXTRACT", url }, (res) => {
            const runtimeErr = chrome.runtime.lastError;
            btn.disabled = false;
            btn.innerText = "SYNC CONTENT";
            const contentArea = document.getElementById('chatContentArea');
            if (!contentArea) return;
            if (runtimeErr) { showSyncError("Extension error: " + runtimeErr.message, "Try reloading the extension.", contentArea); return; }
            if (!res) { showSyncError("No response received.", "Try again.", contentArea); return; }
            if (res.status === "success") {
                const { title, content, platform, messages = [] } = res.data ?? {};
                if (!content && !messages.length) { showSyncError("No content found.", "AI site may have updated.", contentArea); return; }
                updateChat(id, { content: content || "", platform: platform || null, messages });
                contentArea.innerHTML = buildMessagesHtml(messages, content);
                renderTree();
            } else {
                showSyncError(res.msg || "Sync failed.", res.detail || "", contentArea);
            }
        });
    });

    // ── OPEN URL button ──────────────────────────────────────
    document.getElementById('contentView').addEventListener('click', (e) => {
        if (e.target.id !== 'btnOpenUrl') return;
        const url = document.getElementById('urlInput')?.value?.trim();
        if (!url) { alert('Please enter a URL first.'); return; }
        try {
            new URL(url);
            chrome.tabs.create({ url });
        } catch (_) {
            alert('Invalid URL format.');
        }
    });

    // ── Right panel: notes ────────────────────────────────────
    document.getElementById('chatNotes')?.addEventListener('input', (e) => {
        const id = getCurrentId();
        if (id) updateChat(id, { notes: e.target.value });
    });

    // ── Right panel: Generate Summary ────────────────────────
    document.getElementById('btnGenerateSummary')?.addEventListener('click', async () => {
        const id = getCurrentId();
        const chat = getAppData().chats.find(c => c.id === id);
        if (!chat) { alert("No active chat selected."); return; }
        if (!chat.content && !chat.messages?.length) { alert("No content to summarise. Sync first."); return; }
        const apiKey = await getApiKey();
        if (!apiKey) { alert("No API key set."); return; }
        updateSummaryDisplay('<em style="color:var(--text-muted)">Generating...</em>');
        try {
            const text = chat.content || chat.messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
            const summary = await generateSummary(text, apiKey);
            updateSummaryDisplay(`<p style="white-space:pre-wrap">${esc(summary)}</p>`);
            updateChat(id, { summary });
        } catch (err) {
            updateSummaryDisplay(`<span style="color:#f87171">⚠ ${esc(err.message)}</span>`);
        }
    });

    // ── Send message button ──────────────────────────────────
    document.getElementById('contentView').addEventListener('click', (e) => {
        if (e.target.closest('#btnSendMessage')) {
            handleSendMessage();
        }
    });

    // ── Send message via Enter key (Shift+Enter adds newline) ─
    document.getElementById('contentView').addEventListener('keydown', (e) => {
        if (e.target.id === 'sendMessageInput' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // ── Textarea auto-resize ─────────────────────────────────
    document.getElementById('contentView').addEventListener('input', (e) => {
        if (e.target.id === 'sendMessageInput' && e.target.tagName === 'TEXTAREA') {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        }
    });

    // ── Copy message button ──────────────────────────────────
    document.getElementById('contentView').addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.btn-copy-msg');
        if (!copyBtn) return;
        const encoded = copyBtn.dataset.copy;
        if (!encoded) return;
        try {
            const text = decodeURIComponent(escape(atob(encoded)));
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.title = 'Copied!';
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.title = 'Copy message';
                }, 1500);
            });
        } catch (_) {
            console.warn('[REXOW] Copy failed');
        }
    });
}

function handleSendMessage() {
    const id = getCurrentId();
    const chat = getAppData().chats.find(c => c.id === id);
    if (!chat) { console.warn("[REXOW events] SEND: no active chat"); return; }

    const url = chat.url || document.getElementById('urlInput')?.value?.trim();
    if (!url) { showSyncError("Please set a URL first.", ""); return; }

    const input = document.getElementById('sendMessageInput');
    const text = input?.value?.trim();
    if (!text) return;

    input.value = '';
    // Reset textarea height
    if (input.tagName === 'TEXTAREA') {
        input.style.height = 'auto';
    }

    // Optimistically add user message bubble
    const contentArea = document.getElementById('chatContentArea');
    if (contentArea) {
        const copyData = btoa(unescape(encodeURIComponent(text)));
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble msg-user';
        bubble.innerHTML = `
            <div class="msg-header">
            <div class="msg-role">USER</div>
            <button class="btn-copy-msg" data-copy="${copyData}" title="Copy message">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            </div>
            <div class="msg-text markdown-body">${renderMarkdown(text) || `<div style="white-space: pre-wrap;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`}</div>`;
        contentArea.appendChild(bubble);
        contentArea.scrollTop = contentArea.scrollHeight;
    }

    // Disable UI while waiting
    const sendBtn = document.getElementById('btnSendMessage');
    const syncBtn = document.getElementById('btnFetchContent');
    if (sendBtn) sendBtn.disabled = true;
    if (syncBtn) { syncBtn.innerText = "Sending..."; syncBtn.disabled = true; }

    // Step 1: Send the message (fast, returns immediately)
    chrome.runtime.sendMessage({ type: "SEND_ONLY", url, text }, (sendRes) => {
        void chrome.runtime.lastError;
        if (!sendRes || sendRes.status !== "success") {
            const msg = sendRes?.msg || "Failed to send message.";
            showSyncError(msg, sendRes?.detail || "", contentArea);
            if (sendBtn) sendBtn.disabled = false;
            if (syncBtn) { syncBtn.innerText = "SYNC CONTENT"; syncBtn.disabled = false; }
            return;
        }

        // Step 2: Switch to AI tab so user can verify message was sent
        if (syncBtn) syncBtn.innerText = "Waiting for AI...";
        chrome.runtime.sendMessage({ type: "SWITCH_TO_AI_TAB", url });

        // Step 3: Wait for AI response then extract (content script handles the wait)
        chrome.runtime.sendMessage({ type: "WAIT_AND_EXTRACT", url }, (res) => {
            void chrome.runtime.lastError;

            if (sendBtn) sendBtn.disabled = false;
            if (syncBtn) { syncBtn.innerText = "SYNC CONTENT"; syncBtn.disabled = false; }

            if (!res || res.status !== "success" || !res.data) {
                // Wait/extract failed — show warning
                if (contentArea) {
                    showWaitFailedWarning(contentArea, url);
                }
                return;
            }

            // Step 4: Sync conversation in background
            const { content, platform, messages = [] } = res.data;
            updateChat(id, { content: content || "", platform: platform || null, messages });
            if (contentArea) {
                contentArea.innerHTML = buildMessagesHtml(messages, content);
                contentArea.scrollTop = contentArea.scrollHeight;
            }
            renderTree();

            // Sync complete — user can switch back via the float button on the AI tab
            // or by clicking the REXOW tab directly. No intrusive popup needed.
        });
    });
}

function showWaitFailedWarning(contentArea, url) {
    const warningBubble = document.createElement('div');
    warningBubble.className = 'msg-bubble';
    warningBubble.style.cssText = `
        background: linear-gradient(145deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%);
        border-left: 3px solid rgb(245, 158, 11);
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `;
    warningBubble.innerHTML = `
        <div class="msg-role" style="color: rgb(245, 158, 11); display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            SYSTEM
        </div>
        <div class="msg-text" style="color: rgba(255,255,255,0.9);">
            <p style="margin-bottom: 12px; font-size: 13px; line-height: 1.5;">Could not detect AI response. The AI might still be thinking. Try clicking <b>SYNC CONTENT</b> or check the AI tab directly.</p>
            <button id="btnSwitchToAiTab" style="
                background: rgba(245, 158, 11, 0.2);
                color: rgb(253, 230, 138);
                border: 1px solid rgba(245, 158, 11, 0.3);
                padding: 6px 14px;
                border-radius: 6px;
                cursor: pointer;
                font-family: inherit;
                font-size: 12px;
                font-weight: 500;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            ">
                Switch to AI Tab
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
        </div>`;
    contentArea.appendChild(warningBubble);
    contentArea.scrollTop = contentArea.scrollHeight;

    document.getElementById('btnSwitchToAiTab')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: "SWITCH_TO_AI_TAB", url });
    });
}

function showSyncError(msg, detail, container) {
    const target = container || document.getElementById('chatContentArea');
    if (!target) { alert(msg); return; }
    target.innerHTML = `
    <div style="color:#f87171; padding:16px; border:1px dashed #f87171; border-radius:8px; margin:20px;">
    <strong>⚠ Sync Failed</strong><br><small>${esc(msg)}</small>
    ${detail ? `<br><br><span style="color:#fff; font-size:12px;">Tip: ${esc(detail)}</span>` : ''}
    </div>`;
}

function buildMessagesHtml(messages, content) {
    if (Array.isArray(messages) && messages.length) {
        return messages.map(m => {
            const roleClass = (m.role === 'user') ? 'msg-user' : 'msg-assistant';
            const rawText = (m.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // Use marked + katex for both user and assistant messages
            // so that user-typed LaTeX ($...$, $$...$$) and markdown also renders.
            const htmlContent = renderMarkdown(m.text || '') || `<div style="white-space: pre-wrap;">${rawText}</div>`;
            // Encode raw text for copy button
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
    return '<p style="color:var(--text-muted); text-align:center; padding:40px;">No messages found.</p>';
}
