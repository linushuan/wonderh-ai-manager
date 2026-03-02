/**
 * main.js — Dashboard Entry Point
 *
 * Long-lived port 架構（Firefox + Chrome 相容）：
 * - runtime.connect 建立持久連線
 * - background 透過 port.postMessage 回傳 DATA_LOADED
 * - 不依賴 chrome.runtime.sendMessage 廣播（Firefox extension page 收不到）
 */
import { initPort }      from './store.js';
import { initEvents }    from './events.js';
import { renderTree }    from './tree.js';
import { initBackground } from './init.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. 建立 port，資料到齊後 renderTree
    initPort((appData) => {
        renderTree();
    });

    // 2. 綁定所有 UI 事件
    initEvents();

    // 3. 背景圖（非關鍵）
    initBackground();
});
