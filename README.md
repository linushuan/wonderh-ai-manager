# REXOW AI Manager

A **local-first browser extension** for organising, syncing, and annotating AI conversations from ChatGPT, Gemini, and Claude.ai — all stored on your own machine.

---

## What It Does

- **Tree-based workspace** — organise conversations into nested folders, like a file explorer for your AI chats
- **Live content sync** — paste a conversation URL, click **Sync Content**, and the full conversation is extracted from the open tab
- **Research notes** — write per-chat notes in the right panel alongside the extracted content
- **AI summary** — click **Generate Summary** to produce a concise bullet-point summary via OpenAI
- **Local storage** — all data is saved as plain JSON on your disk; nothing leaves your machine except the summary API call

---

## Supported Platforms

| Platform | URL |
|---|---|
| ChatGPT | `chatgpt.com` |
| Google Gemini | `gemini.google.com` |
| Claude | `claude.ai` |

---

## Installation

### 1. Register the Native Host

The native host is a small Python script that reads and writes `~/wonderh_ai_data.json`.

```bash
bash install.sh
```

This registers the host for:
- **Chrome/Edge:** `~/.config/google-chrome/NativeMessagingHosts/`
- **Firefox:** `~/.mozilla/native-messaging-hosts/`

**Requirements:** Python 3 at `/usr/bin/env python3`.

### 2. Load the Extension

**Chrome / Edge:**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

---

## Usage

1. Click the REXOW toolbar icon to open the dashboard
2. Create a **Project** (root folder) with the `+` button
3. Inside a project, create **Folders** and **Chats**
4. On a Chat node:
   - Paste the URL of an open AI conversation tab
   - Click **Sync Content** — the full conversation is extracted and stored
   - Write notes in the right panel
   - Click **Generate Summary** for an AI-generated bullet-point summary

---

## Configuration

### API Key (for Generate Summary)

Enter your OpenAI API key (starts with `sk-`) in the Settings panel on first use. The key is stored in `chrome.storage.local` and is **never** written to your data file on disk.

---

## Architecture

See [`struct.md`](struct.md) for the complete file reference, function signatures, error handling strategy, and testing guide.

### Message flow

```
[Dashboard Page]
    │
    ├─ SAVE_TO_DISK / LOAD_DATA
    │         ↓
    │  [background.js]  ←→  [wonderh_host.py]
    │                              ↓
    │                    ~/wonderh_ai_data.json
    │
    └─ TRIGGER_EXTRACT (url)
              ↓
       [background.js]
              │  tabs.query → find matching tab
              ↓
       [content_extractor.js]  (injected into AI tab)
              │  dynamic import
              ↓
       [chatgpt.js | gemini.js | claude.js]
              ↓
       { title, content, platform, messages[] }
              ↓
       [background.js] → sendResponse → [Dashboard]
```

### Error handling overview

Every layer catches and forwards errors with user-facing messages:

- **Network / API errors** — distinguished by type (no internet vs bad key vs rate limit); each has a specific, actionable message
- **Tab not found** — clear instruction to open the AI tab first
- **Content script not loaded** — instruction to refresh the AI tab
- **Empty extraction result** — detected before storing; shown as inline error in the chat view
- **Invalid input** — name/URL validation before any store operation

---

## Project Structure

```
wonderh-ai-manager/
├── manifest.json
├── install.sh
├── assets/
│   ├── dashboard.css
│   ├── logo.png
│   └── background.jpg
├── entrypoints/
│   ├── background.js
│   ├── content_extractor.js
│   ├── dashboard.html
│   ├── dashboard/
│   │   ├── store.js       # state + persistence
│   │   ├── colors.js      # palette assignment
│   │   ├── icons.js       # SVG factory
│   │   ├── tree.js        # sidebar rendering
│   │   ├── view.js        # main workspace rendering
│   │   ├── events.js      # event wiring
│   │   └── api.js         # OpenAI summary API
│   └── adapters/
│       ├── chatgpt.js
│       ├── gemini.js
│       └── claude.js
└── native-host/
    └── wonderh_host.py
```

---

## Development

### Run Tests

```bash
npm install
npm test              # run all tests with coverage
npm run test:unit     # unit tests only
```

Uses **Jest** + **jest-chrome** + **jsdom**. See `struct.md` for the full test matrix, mock patterns, and priority guide.

---

## Data Storage

All data is saved to `~/wonderh_ai_data.json` as human-readable JSON. You can back it up, inspect it, or version-control it freely. The file is never transmitted anywhere.

The only outbound network request is **Generate Summary**, which sends the conversation text to the OpenAI API using your own key.

---

## License

MIT
