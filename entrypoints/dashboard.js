/**
 * REXOW AI Manager - v7.1
 */
let appData = { folders: [], chats: [] };
let currentSelectedId = null;
let expandedFolders = new Set();

// --- 1. Colors & Icons ---
const Palette = [
    '#f472b6', '#c084fc', '#818cf8', '#22d3ee', '#34d399',
'#a3e635', '#facc15', '#fb923c', '#f87171', '#e879f9',
'#60a5fa', '#2dd4bf'
];
let colorMap = {};

function assignColors() {
    // 用一個 Set 追蹤「同層已用的顏色」，確保相鄰不同色
    const traverse = (parentId) => {
        const siblings = [
            ...appData.folders.filter(f => f.parentId === parentId),
            ...appData.chats.filter(c => c.parentId === parentId)
        ];

        // 記錄這一層已用的顏色，避免相鄰重複
        const usedInLevel = new Set();

        siblings.forEach(item => {
            if (!colorMap[item.id]) {
                // 找第一個不在 usedInLevel 裡的顏色
                const available = Palette.find(c => !usedInLevel.has(c));
                // 萬一全部用完就從頭輪，但實際上 Palette 有 12 色通常不會發生
                colorMap[item.id] = available || Palette[Object.keys(colorMap).length % Palette.length];
            }
            usedInLevel.add(colorMap[item.id]);

            // 遞迴處理子節點
            if (item.parentId !== undefined && appData.folders.find(f => f.id === item.id)) {
                traverse(item.id);
            }
        });
    };
    traverse(null);
}
const getColor = (id) => colorMap[id] || '#fff';

const Icons = {
    folder: (c) => `<svg class="node-icon" style="stroke:${c}" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    file: (c) => `<svg class="node-icon" style="stroke:${c}" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    addFolder: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`,
    addFile: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
    edit: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    close: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
};

function initBackground() {
    const bgUrl = "../assets/background.jpg";
    const img = new Image();
    img.src = bgUrl;
    img.onload = () => {
        document.body.style.backgroundImage = `url('${bgUrl}')`;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
        document.getElementById('welcomeScreen').classList.add('has-bg');
    };
}

// --- 2. Tree Rendering ---
function renderTree() {
    const container = document.getElementById('folderTree');
    if (!container) return;
    container.innerHTML = '';
    assignColors();

    const build = (parentId) => {
        const ul = document.createElement('ul');
        let hasItems = false;

        appData.folders.filter(f => f.parentId === parentId).forEach(f => {
            hasItems = true;
            const li = document.createElement('li');
            li.className = 'tree-node';

            // 判斷這個資料夾目前是否展開
            const isExpanded = expandedFolders.has(f.id);
            // 判斷是否有子節點（決定要不要顯示箭頭）
            const hasChildren =
            appData.folders.some(x => x.parentId === f.id) ||
            appData.chats.some(x => x.parentId === f.id);

            li.innerHTML = `
            <div class="node-content ${f.id === currentSelectedId ? 'active' : ''}" data-id="${f.id}" data-type="folder">
            <button class="btn-chevron ${hasChildren ? '' : 'invisible'} ${isExpanded ? 'expanded' : ''}"
            data-id="${f.id}" title="展開/折疊">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none">
            <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            </button>
            ${Icons.folder(getColor(f.id))}
            <span class="node-name">${f.name}</span>
            <div class="node-actions">
            <button class="action-btn btn-new-chat" data-id="${f.id}" title="New File">${Icons.addFile}</button>
            <button class="action-btn btn-add" data-id="${f.id}" title="New Folder">${Icons.addFolder}</button>
            <button class="action-btn btn-edit" data-id="${f.id}" title="Rename">${Icons.edit}</button>
            <button class="action-btn btn-delete" data-id="${f.id}" data-type="folder">${Icons.trash}</button>
            </div>
            </div>`;

            // 只有展開狀態才遞迴建立子節點
            if (isExpanded) {
                const sub = build(f.id);
                if (sub) li.appendChild(sub);
            }

            ul.appendChild(li);
        });

        // Chat 節點不變（沒有子節點，不需要折疊功能）
        appData.chats.filter(c => c.parentId === parentId).forEach(c => {
            hasItems = true;
            const li = document.createElement('li');
            li.className = 'tree-node';
            li.innerHTML = `
            <div class="node-content ${c.id === currentSelectedId ? 'active' : ''}" data-id="${c.id}" data-type="chat">
            <span class="btn-chevron invisible"></span>
            ${Icons.file(getColor(c.id))}
            <span class="node-name">${c.name}</span>
            <div class="node-actions">
            <button class="action-btn btn-edit" data-id="${c.id}" data-type="chat" title="Rename">${Icons.edit}</button>
            <button class="action-btn btn-delete" data-id="${c.id}" data-type="chat">${Icons.trash}</button>
            </div>
            </div>`;
            ul.appendChild(li);
        });

        return hasItems ? ul : null;
    };

    const rootUl = build(null);
    if (rootUl) container.appendChild(rootUl);
}

// --- 3. Main View ---
function renderMainView(id, type) {
    const container = document.getElementById('contentView');
    const welcome = document.getElementById('welcomeScreen');
    const appShell = document.getElementById('appShell');

    welcome.style.display = 'none';
    container.style.display = 'flex';

    if (type === 'folder') {
        const folder = appData.folders.find(f => f.id === id);
        appShell.classList.remove('right-open');

        const subFolders = appData.folders.filter(f => f.parentId === id);
        const subChats = appData.chats.filter(c => c.parentId === id);
        let gridHtml = '';

        // HackMD 式列表：icon + 名稱橫排，顏色保留
        subFolders.forEach(f => {
            const clr = getColor(f.id);
            gridHtml += `<div class="grid-item" data-id="${f.id}" data-type="folder">${Icons.folder(clr)}<span>${f.name}</span></div>`;
        });
        subChats.forEach(c => {
            const clr = getColor(c.id);
            gridHtml += `<div class="grid-item" data-id="${c.id}" data-type="chat">${Icons.file(clr)}<span>${c.name}</span></div>`;
        });

        container.innerHTML = `
        <div class="folder-dashboard">
        <div class="folder-header">
        ${Icons.folder(getColor(id))}
        <h1>${folder.name}</h1>
        </div>
        <div class="panel-section">
        <label>FOLDER NOTES</label>
        <textarea id="mainNoteEditor" class="glass-input">${folder.notes || ''}</textarea>
        </div>
        <div class="panel-section">
        <label>CONTENTS</label>
        <div class="folder-grid">
        ${gridHtml || '<span style="color:#666; font-style:italic; padding: 12px;">Empty folder</span>'}
        </div>
        </div>
        </div>
        `;
        document.getElementById('mainNoteEditor').oninput = (e) => { folder.notes = e.target.value; sync(); };

    } else if (type === 'chat') {
        const chat = appData.chats.find(c => c.id === id);
        appShell.classList.add('right-open');

        container.innerHTML = `
        <div class="chat-wrapper">
        <div class="chat-header-bar">
        <div class="chat-title-display">
        ${Icons.file(getColor(id))} ${chat.name}
        </div>
        <button id="toggleRightPanel" class="btn-toggle-rotate" title="Toggle Notes Panel">
        ${Icons.close}
        </button>
        </div>
        <div class="chat-interface">
        <div class="chat-placeholder">
        <p>AI Chat Integration Ready</p>
        ${chat.url ? `<a href="${chat.url}" target="_blank" style="color:var(--active-color);">Open Link ↗</a>` : ''}
        </div>
        </div>
        </div>
        `;

        const toggleBtn = document.getElementById('toggleRightPanel');
        toggleBtn.onclick = () => {
            const isNowOpen = appShell.classList.toggle('right-open');
            toggleBtn.classList.toggle('closed', !isNowOpen);
        };

        document.getElementById('chatNotes').value = chat.notes || '';
        document.getElementById('summaryDisplay').innerHTML = chat.summary || 'No summary generated.';
        document.getElementById('chatNotes').oninput = (e) => { chat.notes = e.target.value; sync(); };
    }
}

// --- 4. Select Item ---
function selectItem(id, type) {
    currentSelectedId = id;

    // 動態 active color 跟著節點自身顏色走
    const activeColor = getColor(id);
    document.documentElement.style.setProperty('--active-color', activeColor);

    if (type === 'folder') {
        expandedFolders.add(id);
    }

    renderMainView(id, type);
    renderTree();

    // 確保 active 節點在視窗內
    requestAnimationFrame(() => {
        const activeNode = document.querySelector('.node-content.active');
        if (activeNode) activeNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
}

// --- 5. Event Handling ---
document.getElementById('contentView').onclick = (e) => {
    const gridItem = e.target.closest('.grid-item');
    if (gridItem) selectItem(gridItem.dataset.id, gridItem.dataset.type);
};

document.getElementById('folderTree').onclick = (e) => {
    const btn = e.target.closest('.action-btn');
    const chevron = e.target.closest('.btn-chevron'); // ← 新增：偵測箭頭點擊
    const node = e.target.closest('.node-content');

    // 箭頭點擊：切換折疊狀態，不進入資料夾
    if (chevron && !chevron.classList.contains('invisible')) {
        e.stopPropagation();
        const id = chevron.dataset.id;
        if (expandedFolders.has(id)) {
            expandedFolders.delete(id); // 已展開 → 折疊
        } else {
            expandedFolders.add(id);    // 已折疊 → 展開
        }
        renderTree(); // 只重繪樹，不切換主畫面
        return;
    }

    if (btn) {
        e.stopPropagation();
        const id = btn.dataset.id;
        // 從 node 取 type（btn-edit/btn-delete 可能沒有自己的 data-type）
        const type = btn.dataset.type || node?.dataset.type;

        if (btn.classList.contains('btn-add')) {
            const name = prompt("New Folder Name:");
            if (name) {
                appData.folders.push({ id: crypto.randomUUID(), name, parentId: id, notes: "" });
                saveAndRender();
            }
        } else if (btn.classList.contains('btn-new-chat')) {
            const name = prompt("New Chat Name:");
            if (name) {
                appData.chats.push({ id: crypto.randomUUID(), name, parentId: id, notes: "" });
                saveAndRender();
            }
        } else if (btn.classList.contains('btn-edit')) {
            const item = type === 'folder'
            ? appData.folders.find(x => x.id === id)
            : appData.chats.find(x => x.id === id);
            const newName = prompt("Rename to:", item.name);
            if (newName) {
                item.name = newName;
                saveAndRender();
                if (currentSelectedId === id) selectItem(id, type);
            }
        } else if (btn.classList.contains('btn-delete')) {
            if (confirm("Delete permanently?")) {
                if (type === 'folder') {
                    appData.folders = appData.folders.filter(f => f.id !== id);
                } else {
                    appData.chats = appData.chats.filter(c => c.id !== id);
                }
                showWelcome();
            }
        }
        return;
    }

    if (node) selectItem(node.dataset.id, node.dataset.type);
};

document.getElementById('addRootFolder').onclick = () => {
    const name = prompt("New Project Name:");
    if (name) {
        appData.folders.push({ id: crypto.randomUUID(), name, parentId: null, notes: "" });
        saveAndRender();
    }
};

// showWelcome — REXOW 點擊回主畫面，同時清除 active
function showWelcome() {
    currentSelectedId = null;
    // 重置 active color 回預設粉色
    document.documentElement.style.setProperty('--active-color', '#ec4899');
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.getElementById('contentView').style.display = 'none';
    document.getElementById('appShell').classList.remove('right-open');
    saveAndRender();
}
document.getElementById('brandHome').onclick = showWelcome;

// --- 6. Persistence ---
function saveAndRender() { sync(); renderTree(); }
function sync() {
    chrome.runtime.sendMessage({ type: "SAVE_TO_DISK", payload: appData });
}

chrome.runtime.onMessage.addListener(m => {
    if (m.type === "DATA_LOADED" && m.payload) {
        appData = m.payload;
        if (!appData.folders) appData.folders = [];
        if (!appData.chats) appData.chats = [];
        renderTree();
    }
});

initBackground();
chrome.runtime.sendMessage({ type: "LOAD_DATA" });
