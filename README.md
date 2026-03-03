# REXOW AI Manager

A **local-first browser extension** (Chrome & Firefox) for organising, syncing, and annotating AI conversations — all stored on your own machine.

## Features

- 🗂 **Tree Workspace** — Organise conversations into nested folders, like a file explorer for AI chats
- 🔄 **Live Content Sync** — Paste a conversation URL → click **Sync Content** → full conversation extracted from the open tab
- 💬 **Send Messages** — Type and send messages to AI directly from the dashboard, with auto-sync of the response
- 📝 **Markdown & LaTeX** — AI responses are rendered with full Markdown support (headers, code blocks, tables, lists) and KaTeX math equations
- 📋 **Research Notes** — Per-chat notes panel alongside extracted content
- 🤖 **AI Summary** — One-click bullet-point summary via OpenAI (`gpt-4o-mini`)
- 🔒 **Local Storage** — Data saved as plain JSON on disk (`~/wonderh_ai_data.json`). Nothing leaves your machine except the optional summary API call

## Supported Platforms

| Platform | URL |
|---|---|
| Google Gemini | `gemini.google.com` |
| ChatGPT | `chatgpt.com` |
| Claude | `claude.ai` |

## Installation

### 1. Register the Native Host

```bash
bash install.sh
```

This writes the native messaging host manifest for Chrome and Firefox. **Requires:** Python 3.

### 2. Load the Extension

**Chrome / Edge:**
1. Go to `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select this folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

## Usage

1. Click the REXOW toolbar icon to open the dashboard
2. Create a **Project** (root folder) with the `+` button
3. Inside a project, create **Folders** and **Chats**
4. On a Chat node:
   - Paste the URL of an open AI conversation tab
   - Click **Sync Content** to extract the full conversation
   - Type a message in the send bar to chat with the AI directly
   - Write research notes in the right panel
   - Click **Generate Summary** for an AI-generated summary

## Configuration

### API Key (for Generate Summary)

Enter your OpenAI API key (starts with `sk-`) via the Settings panel. Stored in `chrome.storage.local` only — never written to disk.

## Project Structure

```
wonderh-ai-manager/
├── manifest.json          # Extension manifest (MV3)
├── install.sh             # Native host registration
├── assets/
│   ├── dashboard.css      # CSS import hub
│   ├── base.css           # Variables, reset, layout
│   ├── sidebar.css        # Sidebar & tree
│   ├── workspace.css      # Welcome & folder views
│   ├── chat.css           # Chat UI & messages
│   ├── markdown.css       # Markdown & KaTeX styles
│   ├── panel.css          # Right panel & shared
│   └── lib/               # Bundled marked + katex
├── entrypoints/
│   ├── background.js      # Service worker
│   ├── content_extractor.js
│   ├── dashboard.html
│   ├── dashboard/
│   │   ├── main.js        # Entry point
│   │   ├── store.js       # State & persistence
│   │   ├── events.js      # Event delegation
│   │   ├── view.js        # View rendering
│   │   ├── tree.js        # Sidebar tree
│   │   ├── markdown.js    # Markdown renderer
│   │   ├── colors.js      # Palette assignment
│   │   ├── icons.js       # SVG factory
│   │   ├── api.js         # OpenAI summary API
│   │   └── init.js        # Background image
│   └── adapters/
│       ├── gemini.js
│       ├── chatgpt.js
│       └── claude.js
├── test/                  # Jest test suites
└── native-host/
    └── wonderh_host.py
```

