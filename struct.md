# REXOW AI Manager — Project Structure

## Overview

REXOW is a **Manifest V3 browser extension** (Chrome / Firefox) that lets users:
1. Organise AI conversations into a folder/chat tree (stored locally via native messaging)
2. Sync live conversation content from AI tabs (ChatGPT, Gemini, Claude.ai)
3. Write research notes and generate AI summaries via an external API

---

## Directory Layout

```
wonderh-ai-manager/
├── manifest.json                    # Extension manifest (MV3)
├── install.sh                       # Native host registration script
│
├── assets/
│   ├── dashboard.css                # CSS import hub (@import all below)
│   ├── base.css                     # Variables, reset, body, layout
│   ├── sidebar.css                  # Sidebar, tree, chevrons, actions
│   ├── workspace.css                # Welcome screen, folder dashboard
│   ├── chat.css                     # Chat wrapper, messages, send bar
│   ├── markdown.css                 # Markdown rendering + KaTeX overrides
│   ├── panel.css                    # Right panel, buttons, textarea
│   ├── lib/                         # Bundled libraries (no CDN)
│   │   ├── marked.min.js            # marked v11.2.0 UMD
│   │   ├── katex.min.js             # KaTeX v0.16.8
│   │   ├── katex.min.css            # KaTeX styles
│   │   ├── marked-katex-extension.umd.js  # v4.0.5
│   │   ├── highlight.min.js         # highlight.js v11.9.0
│   │   └── hljs-github-dark.min.css # highlight.js theme
│   ├── logo.png                     # Welcome screen logo
│   └── background.jpg               # Optional background image
│
├── entrypoints/
│   ├── background.js                # Service worker (message router)
│   ├── content_extractor.js         # Content script injected into AI tabs
│   ├── dashboard.html               # Extension main page (loads main.js as type="module")
│   │
│   ├── dashboard/                   # Dashboard JS modules (ES modules, loaded via main.js)
│   │   ├── main.js                  # Entry point — calls initEvents(), initBackground(), loadData()
│   │   ├── init.js                  # One-time setup helpers (background image)
│   │   ├── store.js                 # App state & persistence
│   │   ├── colors.js                # Color palette assignment
│   │   ├── icons.js                 # SVG icon factory
│   │   ├── tree.js                  # Sidebar folder tree rendering
│   │   ├── view.js                  # Main workspace view rendering
│   │   ├── events.js                # Event delegation & UI wiring
│   │   ├── markdown.js              # Markdown + LaTeX rendering (uses global marked/katex)
│   │   └── api.js                   # External AI Summary API calls
│   │
│   └── adapters/
│       ├── chatgpt.js               # ChatGPT page content extractor
│       ├── gemini.js                # Gemini page content extractor + sendMessage + waitForResponse
│       └── claude.js                # Claude.ai page content extractor
│
├── test/
│   ├── adapters.test.js             # ChatGPT, Gemini, Claude adapter tests
│   ├── gemini_extended.test.js      # sendMessage, waitForResponse, prepareForExtract
│   ├── background.test.js           # Service worker routing tests
│   ├── store.test.js                # State management tests
│   ├── api.test.js                  # API call tests
│   ├── content_extractor.test.js    # Content script routing tests
│   ├── dashboard_modules.test.js    # colors, icons, tree, view, markdown, init tests
│   └── events.test.js               # Event delegation tests
│
└── native-host/
    └── wonderh_host.py              # Python native messaging host (reads/writes JSON DB)
```

---

## Data Schema

### `appData` (persisted to `~/wonderh_ai_data.json`)

```jsonc
{
  "folders": [
    {
      "id": "uuid-string",
      "name": "string",
      "parentId": "uuid-string | null",  // null = root
      "notes": "string"
    }
  ],
  "chats": [
    {
      "id": "uuid-string",
      "name": "string",
      "parentId": "uuid-string",
      "url": "string",           // URL of the AI conversation tab
      "platform": "chatgpt | gemini | claude | null",
      "notes": "string",         // right-panel research notes
      "summary": "string",       // AI-generated summary (plain text)
      "content": "string",       // full extracted conversation text (flat)
      "messages": [              // structured message history
        { "role": "user | assistant", "text": "string" }
      ]
    }
  ]
}
```

---

## Message Protocol

### Long-lived Port（資料載入）

Dashboard 透過 `chrome.runtime.connect({ name: "dashboard" })` 建立持久連線。Background 收到 port 訊息後透過同一個 port 回傳資料。**這是 Firefox/Chrome 相容的唯一可靠方式**（Firefox extension page 無法收到 `runtime.sendMessage` 廣播）。

| 方向 | Port 訊息 `type` | Payload | 說明 |
|---|---|---|---|
| dashboard → background | `LOAD_DATA` | — | 請求從 native host 載入資料 |
| background → dashboard | `DATA_LOADED` | `{ payload: appData }` | native host 回傳後推送給所有已連線的 port |
| background → dashboard | `LOAD_ERROR` | `{ msg: string }` | native host 無法連線時回傳 |

### One-shot Messages（儲存 & 擷取）

| `type` | 方向 | Payload | Response |
|---|---|---|---|
| `SAVE_TO_DISK` | dashboard → background | `{ payload: appData }` | `{ status: "ok" }` or error |
| `TRIGGER_EXTRACT` | dashboard → background | `{ url: string }` | `{ status, data }` or error |
| `EXTRACT_CONTENT` | background → content script | — | `{ status, data }` or error |
| `SEND_ONLY` | dashboard → background → content script | `{ url, text }` | `{ status: "success", sent: true }` |
| `RELOAD_AND_EXTRACT`| dashboard → background | `{ url }` | `{ status, data }` (reloads tab first) |

### Error response shape

```jsonc
{ "status": "error", "msg": "Short user-facing message", "detail": "Actionable tip" }
```

---

## Error Handling Strategy

Each layer has defined responsibilities for catching and surfacing errors.

| Layer | What it catches | How it surfaces |
|---|---|---|
| `store.js` | Invalid input, `sendMessage` failures, `lastError` | `console.error` + throws for invalid input; silent for transient send failures |
| `background.js` | Null native port, `tabs.query` failure, null content script response, `lastError` | Returns `{ status: "error" }` to caller |
| `content_extractor.js` | Unsupported URL, adapter load failure, adapter crash, empty result | Returns `{ status: "error", msg, detail }` to background |
| `adapters` | Missing DOM elements, empty text nodes | Throws with descriptive platform-specific message |
| `api.js` | Network failure, HTTP errors (401/429/500), malformed response, invalid key format | Throws with user-friendly message; network vs API vs parse errors are distinguished |
| `events.js` | All of the above, `chrome.runtime.lastError` in SYNC callback, undefined response | `showSyncError()` renders inline error UI; `alert()` for CRUD operations |

---

## File Reference

---

### `manifest.json`
Extension configuration. No functions.

**Key fields:**
- `permissions`: `nativeMessaging`, `tabs`, `storage`, `scripting`
- `host_permissions`: ChatGPT, Gemini, Claude.ai
- `web_accessible_resources`: adapter JS files (required for dynamic import in content scripts)

---

### `install.sh`
Bash script. No functions.

**What it does:** Writes the native host manifest JSON to Firefox and Chrome config directories so the browser can launch `wonderh_host.py`.

---

### `native-host/wonderh_host.py`

Reads/writes `~/wonderh_ai_data.json` over stdio using the Chrome Native Messaging protocol (4-byte length-prefixed JSON).
Writes a plain-text debug log to `~/wonderh_host.log` (append mode) so you can verify the host is being launched by the browser.

| Function | Signature | Description |
|---|---|---|
| `send_message` | `send_message(message: dict) -> None` | Encodes dict as JSON, prepends 4-byte length, writes to stdout |
| `read_message` | `read_message() -> dict \| None` | Reads 4-byte length from stdin, reads that many bytes, returns parsed dict or None on EOF |
| `log` | `log(msg: str) -> None` | Appends timestamped line to `~/wonderh_host.log`; uses plain file I/O (not `logging` module) to avoid any stdio interference |
| main loop | — | Dispatches `action: "save"` (writes JSON, logs folder/chat count) and `action: "load"` (reads JSON, logs folder/chat count) |

**Debug log location:** `~/wonderh_host.log`

If this file does **not** exist after opening the dashboard, the native host is not being launched. Check:
1. `~/.mozilla/native-messaging-hosts/com.wonderh.ai.manager.json` exists and has the correct `path`
2. `python3` is available at the path specified in the shebang (`#!/usr/bin/env python3`)
3. The script file is executable (`chmod +x wonderh_host.py`)
4. Background console (`about:debugging` → Inspect) shows no `connectNative failed` error

**Test targets:** `tests/test_host.py`
- Unit: `send_message` / `read_message` round-trip
- Unit: `save` action writes correct JSON to file
- Unit: `load` action returns correct data from file
- Unit: handles missing DB file (auto-creates with empty schema)
- Unit: `log` appends to log file without interfering with stdio

---

### `entrypoints/background.js`

Service worker. Manages native port lifecycle and message routing.

| Function / Handler | Signature | Description |
|---|---|---|
| `connectNative` | `connectNative() -> void` | Opens native messaging port; sets up `onMessage` (forwards `DATA_LOADED`, silences "no receivers" lastError) and `onDisconnect` (reads lastError, nulls port) |
| `onMessage` handler | — | Routes messages; see table below |
| `action.onClicked` | — | Opens `dashboard.html` in a new tab |

**Message routing:**

| `req.type` | Guards | Action |
|---|---|---|
| `SAVE_TO_DISK` | checks `nativePort !== null` | `nativePort.postMessage({ action: "save", data })` → `sendResponse({ status: "ok" })` |
| `LOAD_DATA` | checks `nativePort !== null` | `nativePort.postMessage({ action: "load" })` — response comes async via `nativePort.onMessage` |
| `TRIGGER_EXTRACT` | validates `url` | `chrome.tabs.query` → find tab → `tabs.sendMessage(EXTRACT_CONTENT)` → relay result |
| `SEND_ONLY` | validates `url`, `text`| `chrome.tabs.query` → find tab → `tabs.sendMessage(SEND_ONLY)` → returns immediately after clicking send |
| `RELOAD_AND_EXTRACT`| validates `url` | `chrome.tabs.query` → find tab → `tabs.reload()` → waits for `onUpdated` complete → `tabs.sendMessage(EXTRACT_CONTENT)` |
| `SWITCH_TO_AI_TAB` | validates `url` | `chrome.tabs.query` → find tab → `tabs.update({active: true})` → `windows.update({focused: true})` |

**`nativePort.onMessage` handler:**
Native host responds with `{ status: "ok", data: { folders, chats } }` for load, or `{ status: "ok" }` for save.
Handler detects load responses by checking `res.data !== undefined`, then broadcasts `DATA_LOADED` via `chrome.runtime.sendMessage` (broadcast reaches all extension pages including dashboard).
⚠️ Previous bug: was forwarding entire `res` instead of `res.data`, so `setAppData` received `{ status, data }` and normalised folders/chats to `[]`.

**Service worker lifecycle note:**
`connectNative()` is called immediately on service worker start (not lazily on first message). This ensures the port is ready before any `LOAD_DATA` arrives. If the port drops during idle, it is reconnected on the next incoming message.

**Error cases handled:**
- `nativePort` is null → responds `{ status: "error", msg: "Native host not connected." }`
- `tabs.query` fails → responds with `lastError.message`
- No matching tab → responds with `msg: "No matching tab found"` + actionable `detail`
- Content script returns null → responds `{ status: "error", msg: "No response from content script." }`
- `chrome.runtime.lastError` in `tabs.sendMessage` callback → responds with error

**Test targets:** `tests/unit/background.test.js`
- Unit: `connectNative` called when port is null
- Unit: `SAVE_TO_DISK` posts correct message, responds ok
- Unit: `SAVE_TO_DISK` responds error when nativePort is null
- Unit: `TRIGGER_EXTRACT` finds correct tab by URL prefix
- Unit: `TRIGGER_EXTRACT` responds error when no matching tab
- Unit: `TRIGGER_EXTRACT` responds error when content script returns null
- Unit: `TRIGGER_EXTRACT` validates url is present

---

### `entrypoints/content_extractor.js`

Content script. Listens for `EXTRACT_CONTENT`, routes to correct adapter via dynamic import.

| Function | Signature | Description |
|---|---|---|
| `runAdapter` | `async runAdapter() -> { title, content, platform, messages[] }` | Detects URL, imports adapter, runs `extract()`, validates and normalises result |
| `onMessage` handler | — | Listens for `EXTRACT_CONTENT`, wraps `runAdapter()` in try/catch, sends typed response |

**Validation steps in `runAdapter`:**
1. URL must match a supported platform (throws with user-friendly message if not)
2. Adapter module must export a class (not undefined)
3. `adapter.extract()` is wrapped in its own try/catch (crash is reported separately)
4. Result must be a non-null object with non-empty `content` string
5. `messages` array is normalised to `[]` if missing

**Test targets:** `tests/unit/content_extractor.test.js`
- Unit: routes to correct adapter path for chatgpt.com, gemini.google.com, claude.ai
- Unit: throws on unsupported URL
- Unit: throws if adapter export is not a function
- Unit: throws if adapter crashes
- Unit: throws if `content` is empty
- Unit: normalises missing `messages` to `[]`

---

### `entrypoints/adapters/chatgpt.js`

| Class | Method | Returns |
|---|---|---|
| `ChatGPTAdapter` | `extract()` | `{ title, content, platform: "chatgpt", messages: [{role, text}] }` |

**DOM strategy:**
1. Title: `div[class*="sidebar"] a[class*="bg-token"]` → fallback `document.title`
2. Messages: `[data-message-author-role]` nodes → role from attribute value
3. Fallback: `main.innerText` if no role nodes (returns `messages: []`)
4. Throws if `<main>` is missing or empty

**Test targets:** `test/adapters.test.js`
- Unit: extracts messages with correct `role` from attribute
- Unit: skips empty text nodes
- Unit: fallback path when no `[data-message-author-role]` nodes
- Unit: throws when `<main>` missing
- Unit: throws when page is empty

---

### `entrypoints/adapters/gemini.js`

| Class | Method | Returns |
|---|---|---|
| `GeminiAdapter` | `extract()` | `{ title, content, platform: "gemini", messages: [{role, text}] }` |

**DOM strategy:**
1. Title: `h1[class*="conversation-title"]` → fallback `document.title`
2. Messages: Converts rich HTML inside `<model-response>` and `.query-text-line` elements back to standard Markdown (`_domToMarkdown` loop).
3. Detects specific elements: code blocks + highlight.js language detection, inline and display LaTeX equations (reads `data-math`), structured tables (`_tableToMarkdown`), lists, formatting (bold/italic).
4. Fallback Content: `infinite-scroller` innerText, filtered through `NOISE_LINES` Set (returns `messages: []`).

**Test targets:** `test/adapters.test.js`
- Unit: extracts explicit user-query and model-response elements into structured messages
- Unit: filters all noise lines from output when structured elements are missing
- Unit: preserves non-noise content
- Unit: fallback when `infinite-scroller` absent
- Unit: throws when fallback body text is too short
- Unit: throws when cleaned content is empty

---

### `entrypoints/adapters/claude.js`

| Class | Method | Returns |
|---|---|---|
| `ClaudeAdapter` | `extract()` | `{ title, content, platform: "claude", messages: [{role, text}] }` |

**DOM strategy:**
1. Title: `div[class*="truncate"]` → fallback `document.title`
2. Messages: `.font-claude-message` elements
3. Role detection: checks DOM ancestry for `[data-testid*="human"]`, `[class*="human"]`, `[class*="user"]` → `"user"` if matched, else `"assistant"`
4. Fallback: `.grid-cols-1` innerText (returns `messages: []`)
5. Throws if neither selector finds content

**Test targets:** `test/adapters.test.js`
- Unit: extracts messages from `.font-claude-message`
- Unit: role detection via DOM ancestry (user vs assistant)
- Unit: skips empty message nodes
- Unit: fallback to `.grid-cols-1`
- Unit: throws when neither selector found

---

### `entrypoints/dashboard.html`

Extension main page. Loads the dashboard as ES modules.

**Key change from original:** replaced `<script src="dashboard.js">` with `<script type="module" src="dashboard/main.js">`. Without `type="module"`, the browser ignores ES `import/export` syntax and none of the new modules are executed.

**Notable elements:**

| Element ID | Purpose |
|---|---|
| `#addRootFolder` | `+` button in sidebar header — creates root-level project folder |
| `#brandHome` | REXOW logo text — click to return to welcome screen |
| `#folderTree` | `<nav>` container rendered by `tree.js` |
| `#contentView` | Main workspace area rendered by `view.js` |
| `#chatNotes` | Right-panel research notes textarea |
| `#summaryDisplay` | Right-panel AI summary display area |
| `#btnGenerateSummary` | Triggers AI summary generation (was missing in original) |

---

### `entrypoints/dashboard/main.js`

Entry point loaded by `dashboard.html`. No logic of its own.

| Function | Signature | Description |
|---|---|---|
| DOMContentLoaded handler | — | Calls `initEvents()`, `initBackground()`, `loadData()` in order |

**Load order matters:**
1. `initEvents()` — binds all handlers before any user interaction
2. `initBackground()` — non-blocking image load, fires asynchronously
3. `loadData()` — triggers `LOAD_DATA` → native host → `DATA_LOADED` → `renderTree()`

---

### `entrypoints/dashboard/init.js`

One-time setup helpers. Separated from `main.js` to keep the entry point minimal.

| Function | Signature | Description |
|---|---|---|
| `initBackground` | `() -> void` | Creates an `Image` object, attempts to load `../assets/background.jpg`; on success applies it as `body` background and adds `has-bg` class to `#welcomeScreen`; silently ignores missing file |

---

### `entrypoints/dashboard/store.js`

Central state and persistence. All mutations call `sync()`.

| Function | Signature | Throws | Description |
|---|---|---|---|
| `getAppData` | `() -> AppData` | — | Returns current in-memory state |
| `setAppData` | `(data: AppData) -> void` | — | Replaces state; normalises missing `folders`/`chats` to `[]`; logs error if data is not an object |
| `getCurrentId` | `() -> string \| null` | — | Currently selected node ID |
| `setCurrentId` | `(id: string) -> void` | — | Sets selected node ID |
| `getExpandedFolders` | `() -> Set<string>` | — | Set of expanded folder IDs |
| `addFolder` | `(name: string, parentId: string \| null) -> Folder` | if name empty | Creates folder with UUID, pushes to state, calls `sync()` |
| `updateFolder` | `(id: string, patch: Partial<Folder>) -> void` | — | Merges patch; warns if ID not found |
| `deleteFolder` | `(id: string) -> void` | — | BFS to collect all descendant IDs; removes folders and chats in one pass |
| `addChat` | `(name: string, parentId: string) -> Chat` | if name empty or no parentId | Creates chat with full default schema, calls `sync()` |
| `updateChat` | `(id: string, patch: Partial<Chat>) -> void` | — | Merges patch; warns if ID not found |
| `deleteChat` | `(id: string) -> void` | — | Filters chat from array, calls `sync()` |
| `initPort` | `(onLoaded: (AppData) => void) -> void` | — | 建立 long-lived port；port 建立後立刻發送 `LOAD_DATA`；收到 `DATA_LOADED` 時呼叫 `setAppData` 再執行 `onLoaded` callback；port 斷線時 1 秒後自動重連 |
| `sync` | `() -> void` | — | `chrome.runtime.sendMessage(SAVE_TO_DISK)`；消耗 `lastError`；wrapped in try/catch |
| `loadData` | 已移除 | — | 改由 `initPort` 在 port 建立後自動觸發 |

**Test targets:** `tests/unit/store.test.js`
- Unit: `addFolder` creates with UUID and correct parentId
- Unit: `addFolder` throws on empty name
- Unit: `deleteFolder` recursively removes all descendants
- Unit: `deleteFolder` does not remove unrelated nodes
- Unit: `updateChat` merges without overwriting other fields
- Unit: `sync` calls `sendMessage` with correct payload
- Unit: `setAppData` normalises missing arrays
- Edge: `deleteFolder` with deeply nested tree

---

### `entrypoints/dashboard/colors.js`

| Function | Signature | Description |
|---|---|---|
| `assignColors` | `(appData: AppData) -> colorMap: Object` | Clears and rebuilds colorMap; BFS traversal ensures siblings get different palette colors |
| `getColor` | `(id: string) -> string` | Returns hex color for ID; fallback `'#fff'` |

**Test targets:** `tests/unit/colors.test.js`
- Unit: siblings at same level get different colors
- Unit: `getColor` returns `'#fff'` for unknown ID
- Unit: re-running `assignColors` resets and rebuilds map

---

### `entrypoints/dashboard/icons.js`

Pure SVG string factory, no side effects.

| Export | Type | Description |
|---|---|---|
| `Icons.folder` | `(color: string) -> string` | Folder SVG with given stroke color |
| `Icons.file` | `(color: string) -> string` | File SVG with given stroke color |
| `Icons.addFolder` | `string` | Static add-folder SVG |
| `Icons.addFile` | `string` | Static add-file SVG |
| `Icons.edit` | `string` | Static edit/pencil SVG |
| `Icons.trash` | `string` | Static trash SVG |
| `Icons.close` | `string` | Static X SVG |
| `Icons.chevronRight` | `string` | Static chevron SVG for tree expand/collapse |

---

### `entrypoints/dashboard/tree.js`

| Function | Signature | Description |
|---|---|---|
| `renderTree` | `() -> void` | Clears `#folderTree`; calls `assignColors`; calls `buildNode(null)` |
| `buildNode` (internal) | `(parentId: string \| null) -> HTMLUListElement \| null` | Recursively builds `<ul>` of folder and chat nodes; respects `expandedFolders` set; returns null if no children |

---

### `entrypoints/dashboard/view.js`

| Function | Signature | Description |
|---|---|---|
| `renderMainView` | `(id: string, type: "folder"\|"chat") -> void` | Hides welcome screen; shows contentView; routes to `renderFolderView` or `renderChatView` |
| `renderFolderView` | `(folder: Folder) -> void` | Renders header + notes textarea + grid of sub-items |
| `renderChatView` | `(chat: Chat) -> void` | Renders header + URL input bar + SYNC button + message list; populates right panel notes and summary; wires `#toggleRightPanel` |
| `renderMessagesHtml` (internal) | `(messages: Message[]) -> string` | Maps messages array to HTML; returns empty-state placeholder if array is empty |
| `showWelcome` | `() -> void` | Resets currentId; resets `--active-color`; shows welcome screen; removes `right-open` class |
| `updateSummaryDisplay` | `(html: string) -> void` | Sets innerHTML of `#summaryDisplay`; null-checks element |
| `selectItem` | `(id: string, type: "folder"\|"chat") -> void` | Sets currentId; calls `assignColors`; sets `--active-color`; expands folder if applicable; calls `renderMainView` + `renderTree`; scrolls active node into view |

---

### `entrypoints/dashboard/events.js`

| Function | Signature | Description |
|---|---|---|
| `initEvents` | `() -> void` | Wires all event listeners; must be called once on DOMContentLoaded |

**Event bindings:**

| Element | Event | Action | Error handling |
|---|---|---|---|
| `chrome.runtime.onMessage` | — | `DATA_LOADED` → `setAppData` + `renderTree` | Warns if payload missing |
| `#brandHome` | `click` | `showWelcome()` | — |
| `#addRootFolder` | `click` | Prompt → `addFolder(name, null)` | `alert()` on throw |
| `#folderTree` | `click` (delegated) | Chevron toggle / CRUD buttons / node select | `alert()` on CRUD errors; `console.error` on selectItem |
| `#contentView` | `click` (delegated) | Grid item → `selectItem` | `console.error` on failure |
| `#toggleRightPanel` | `click` (delegated via `#contentView`) | Toggles `right-open` class on `#appShell`; toggles `closed` class on button (rotates icon 45° → looks like `+` when panel is closed) | — |
| `#contentView` | `input` (delegated) | `mainNoteEditor` → `updateFolder`; `urlInput` → `updateChat` | — |
| `#btnFetchContent` | `click` (delegated) | Validate URL → `TRIGGER_EXTRACT` → render result | Reads `lastError` first; handles null `res`; `showSyncError()` for all failure paths |
| `#chatNotes` | `input` | `updateChat(id, { notes })` | — |
| `#btnGenerateSummary` | `click` | `generateSummary()` → `updateSummaryDisplay` | Inline error display in summary panel |

**Helper functions:**

| Function | Signature | Description |
|---|---|---|
| `showSyncError` (internal) | `(msg: string, detail: string, container?: Element) -> void` | Renders styled error HTML into `#chatContentArea` or falls back to `alert()` |
| `buildMessagesHtml` (internal) | `(messages: Message[]) -> string` | Same as `renderMessagesHtml` in view.js; kept here to avoid circular import |

---

### `entrypoints/dashboard/api.js`

| Function | Signature | Throws | Description |
|---|---|---|---|
| `generateSummary` | `async (content: string, apiKey: string) -> string` | Network error / HTTP 401,429,500 / empty response / invalid key | Sends to OpenAI `gpt-4o-mini`; truncates content to 12,000 chars; returns plain text summary |
| `getApiKey` | `() -> Promise<string \| null>` | — | Reads from `chrome.storage.local`; returns null on error or missing key |
| `saveApiKey` | `(key: string) -> Promise<void>` | if key empty | Trims and saves to `chrome.storage.local`; rejects on `lastError` |

**Error taxonomy in `generateSummary`:**

| Condition | Error message |
|---|---|
| `content` empty | `"No content to summarise."` |
| `apiKey` missing `sk-` prefix | `"Invalid API key format."` |
| `fetch` throws | `"Network error: could not reach OpenAI."` |
| HTTP 401 | `"Invalid API key. Please check your key in Settings."` |
| HTTP 429 | `"Rate limit exceeded. Please wait and try again."` |
| HTTP 500 | `"OpenAI server error. Please try again later."` |
| Other HTTP error | Raw `error.message` from response body |
| JSON parse fails | `"Could not parse API response."` |
| Empty `choices` | `"API returned an empty summary."` |

**Test targets:** `tests/unit/api.test.js`
- Unit: returns summary text on success
- Unit: sends correct `Authorization` header
- Unit: truncates content to 12,000 chars
- Unit: throws with correct message for HTTP 401, 429, 500
- Unit: throws on network failure (fetch throws)
- Unit: throws on empty API key / invalid format
- Unit: throws on empty `choices` response
- Unit: `getApiKey` returns null when not set
- Unit: `saveApiKey` rejects on empty key

---

## Testing Strategy

### Framework

**[Jest](https://jestjs.io/)** + **[jest-chrome](https://github.com/extend-chrome/jest-chrome)** + **jsdom**

```bash
npm install --save-dev jest jest-chrome @jest-environment-jsdom
npm test
```

---

### Test Files

```
tests/
├── unit/
│   ├── store.test.js
│   ├── colors.test.js
│   ├── api.test.js
│   ├── background.test.js
│   ├── content_extractor.test.js
│   └── adapters/
│       ├── chatgpt.test.js
│       ├── gemini.test.js
│       └── claude.test.js
├── integration/
│   ├── sync_flow.test.js      # TRIGGER_EXTRACT → tab → EXTRACT_CONTENT → result
│   └── save_load.test.js      # save → native host → load round-trip
└── e2e/
    └── README.md              # Manual E2E checklist
```

---

### Test Priority Matrix

| Test | Type | Priority | Why |
|---|---|---|---|
| `store.deleteFolder` recursion | Unit | 🔴 Critical | Orphan nodes cause data corruption |
| `background.TRIGGER_EXTRACT` null response | Unit | 🔴 Critical | Service worker restart silently breaks sync |
| `api.generateSummary` HTTP 401/429 | Unit | 🔴 Critical | Common failure; must show actionable message |
| `api.generateSummary` network error | Unit | 🔴 Critical | No internet = must not crash |
| `content_extractor` unsupported URL | Unit | 🟠 High | Wrong adapter = silent wrong data |
| `content_extractor` empty result | Unit | 🟠 High | Must surface, not silently store empty string |
| `store.sync` reads lastError | Unit | 🟠 High | Chrome logs unchecked errors otherwise |
| `background` null nativePort | Unit | 🟠 High | Port drop silently fails saves |
| `adapters` DOM extraction | Unit | 🟡 Medium | Breaks when AI site updates layout |
| `colors` sibling uniqueness | Unit | 🟡 Medium | Visual regression |
| `sync_flow` integration | Integration | 🟠 High | Validates full sync pipeline |
| `save_load` round-trip | Integration | 🟠 High | Validates persistence pipeline |

---

### Mock Patterns

**Chrome APIs:**
```js
// sendMessage with callback
chrome.runtime.sendMessage.mockImplementation((msg, cb) => cb?.({ status: "ok" }));
// Read lastError in callback
Object.defineProperty(chrome.runtime, 'lastError', { get: () => null, configurable: true });

// tabs.query
chrome.tabs.query.mockImplementation((_, cb) =>
  cb([{ id: 42, url: "https://chatgpt.com/c/abc" }])
);

// storage.local
chrome.storage.local.get.mockImplementation((_, cb) => cb({ apiKey: "sk-test" }));
chrome.storage.local.set.mockImplementation((_, cb) => cb());
```

**DOM (jsdom):**
```js
document.body.innerHTML = `
  <main>
    <div data-message-author-role="user">Hello</div>
    <div data-message-author-role="assistant">Hi</div>
  </main>`;
```

**fetch:**
```js
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    choices: [{ message: { content: "• Point 1\n• Point 2" } }]
  })
});

// Network failure
global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
```

---

## Known Issues / TODOs

| # | File | Issue | Priority |
|---|---|---|---|
| 1 | `api.js` | Settings UI for entering/updating API key not yet built | 🟠 Add |
| 2 | `claude.js` | Role detection via ancestry is best-effort; Claude DOM may update | 🟡 Monitor |
| 3 | `gemini.js` | Message extraction uses `<user-query>` and `<model-response>`; fallback exists. | 🟡 Monitor |
| 4 | All adapters | AI sites update their DOM regularly; selectors will need maintenance | 🟡 Ongoing |

---

## Changelog

### Session 7
- **根本原因確認**：reload 後資料消失的真正原因是 native host 根本沒被瀏覽器啟動（`~/wonderh_host.log` 不存在即可確認）
- **`wonderh_host.py`**：加入 `log()` 函式，寫入 `~/wonderh_host.log`；每次啟動、save、load 都留下紀錄，方便診斷連線問題

### Session 8
- **Markdown & LaTeX rendering**: Added `markdown.js` using `marked v11.2.0` + `marked-katex-extension v4.0.5` + `katex v0.16.8` (all bundled locally in `assets/lib/` to avoid MV3 CSP restrictions)
- **CSS modularisation**: Split 998-line `dashboard.css` into 6 modular files.
- **Background Routing**: Added new routing architecture with long-lived native ports.

### Session 9 (Newest)
- **Gemini HTML to Markdown**: Rewrote Gemini adapter extraction (`_domToMarkdown`) to traverse raw DOM and convert rich HTML (tables, inline/display LaTeX, code blocks, bold/italics) back to clean Markdown, replacing broken `innerText` method. Prevented table extraction from swallowing surrounding content.
- **Poll-based Send Message Algorithm**: Replaced unreliable MutationObserver wait with a robust polling system. Dashboard uses `SEND_ONLY` (inject + click send, returns immediately), then polls at `[5s, 10s, 15s, 30s, 45s, 60s]` using `RELOAD_AND_EXTRACT` to refresh the AI background tab and diff the messages.
- **Syntax Highlighting**: Integrated `highlight.js v11.9.0` (github-dark theme) into the dashboard markdown renderer.
- **Bug fixes**: Fixed `SWITCH_TO_AI_TAB` mapping; dashboard now reliably calls `renderMarkdown` for assistant messages. All 118 unit tests passing.
