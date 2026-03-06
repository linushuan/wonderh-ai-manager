/**
 * tree.js — Sidebar Folder Tree Rendering
 */
import { getAppData, getCurrentId, getExpandedFolders } from './store.js';
import { assignColors, getColor } from './colors.js';
import { Icons } from './icons.js';

/** Escape HTML special chars */
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/**
 * Rebuild and render the full sidebar tree from current app state.
 */
export function renderTree() {
    const container = document.getElementById('folderTree');
    if (!container) return;
    container.innerHTML = '';

    assignColors(getAppData());

    const rootUl = buildNode(null);
    if (rootUl) container.appendChild(rootUl);
}

/**
 * Recursively build a <ul> for all children of parentId.
 * @param {string|null} parentId
 * @returns {HTMLElement|null}
 */
function buildNode(parentId) {
    const { folders, chats } = getAppData();
    const currentId = getCurrentId();
    const expandedFolders = getExpandedFolders();

    const ul = document.createElement('ul');
    let hasItems = false;

    folders.filter(f => f.parentId === parentId).forEach(f => {
        hasItems = true;
        const isExpanded = expandedFolders.has(f.id);
        const hasChildren =
            folders.some(x => x.parentId === f.id) ||
            chats.some(x => x.parentId === f.id);

        const li = document.createElement('li');
        li.className = 'tree-node';
        li.innerHTML = `
            <div class="node-content ${f.id === currentId ? 'active' : ''}" data-id="${f.id}" data-type="folder">
                <button class="btn-chevron ${hasChildren ? '' : 'invisible'} ${isExpanded ? 'expanded' : ''}"
                    data-id="${f.id}" title="Toggle">
                    ${Icons.chevronRight}
                </button>
                ${Icons.folder(getColor(f.id))}
                <span class="node-name">${esc(f.name)}</span>
                <div class="node-actions">
                    <button class="action-btn btn-new-chat" data-id="${f.id}" title="New Chat">${Icons.addFile}</button>
                    <button class="action-btn btn-add" data-id="${f.id}" title="New Folder">${Icons.addFolder}</button>
                    <button class="action-btn btn-edit" data-id="${f.id}" data-type="folder" title="Rename">${Icons.edit}</button>
                    <button class="action-btn btn-delete" data-id="${f.id}" data-type="folder">${Icons.trash}</button>
                </div>
            </div>`;

        if (isExpanded) {
            const sub = buildNode(f.id);
            if (sub) li.appendChild(sub);
        }

        ul.appendChild(li);
    });

    chats.filter(c => c.parentId === parentId).forEach(c => {
        hasItems = true;
        const li = document.createElement('li');
        li.className = 'tree-node';
        li.innerHTML = `
            <div class="node-content ${c.id === currentId ? 'active' : ''}" data-id="${c.id}" data-type="chat">
                <span class="btn-chevron invisible"></span>
                ${Icons.file(getColor(c.id))}
                <span class="node-name">${esc(c.name)}</span>
                <div class="node-actions">
                    <button class="action-btn btn-edit" data-id="${c.id}" data-type="chat" title="Rename">${Icons.edit}</button>
                    <button class="action-btn btn-delete" data-id="${c.id}" data-type="chat">${Icons.trash}</button>
                </div>
            </div>`;
        ul.appendChild(li);
    });

    return hasItems ? ul : null;
}
