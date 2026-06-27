# NeetCode 150 GitHub Tracker

A Manifest V3 Chrome extension that watches your LeetCode submissions and automatically commits your NeetCode 150 progress to a GitHub repo — a live `progress.json` plus an auto-generated `README.md` with a progress bar, per-topic breakdown, and a table of solved problems.

## How it works

1. **`src/content.js`** runs on every `leetcode.com/problems/*` page. It watches for an "Accepted" result three ways (DOM mutation observer, `fetch` interception, `XMLHttpRequest` interception) to catch LeetCode's various submission-result UI patterns.
2. When a solve is detected, it sends a `PROBLEM_SOLVED` message to the background service worker and shows a small toast.
3. **`src/background.js`** receives the message, saves progress locally (`chrome.storage.local`), then pushes `progress.json` and `README.md` to your configured GitHub repo via the Contents API.
4. **`popup.html`** shows your live stats: a progress ring, easy/medium/hard breakdown, per-topic bars, and your 5 most recent solves.
5. **`options.html`** is where you paste your GitHub username, repo name, and a personal access token.

## Setup

1. Load the extension (`chrome://extensions` → enable Developer mode → "Load unpacked" → select this folder).
2. Click the extension icon → ⚙️ → fill in:
   - **GitHub username**
   - **Repository name** (must already exist)
   - **Personal access token** — needs `repo` scope (classic) or Contents read/write (fine-grained). The settings page has a direct link to generate one with the right scope pre-filled.
3. Go solve a NeetCode 150 problem on LeetCode. On acceptance, your repo's `progress.json` and `README.md` will update automatically.

## Notes on the Manifest V3 implementation

A couple of MV3-specific details that are easy to get wrong and are handled here deliberately:

- **`importScripts` path resolution**: `background.js` lives at `src/background.js`, so its own URL is `.../src/background.js`. `importScripts('neetcode150.js')` (not `'src/neetcode150.js'`) is correct, since the path resolves relative to the worker's own directory.
- **`const` doesn't attach to the global object**: `neetcode150.js` declares `const NEETCODE_150 = [...]`, which (unlike `var`) does not become `self.NEETCODE_150` automatically in a classic worker script. The file explicitly does `globalThis.NEETCODE_150 = NEETCODE_150;` at the bottom so both the service worker and the content-script context can see it.
- **Respond before the async work finishes**: the `chrome.runtime.onMessage` listener calls `sendResponse()` immediately, then does the (potentially slow, multi-request) GitHub sync afterward. Waiting on the full round-trip before responding risks "the message channel closed before a response was received" if the LeetCode tab navigates away first.
- **Guarded `sendMessage`**: the content script checks `chrome.runtime.lastError` in its response callback and wraps the call in `try/catch`, since the extension context can be invalidated mid-flight by a page navigation.

## File structure

```
manifest.json
popup.html
options.html
src/
  background.js     — service worker: storage + GitHub sync
  content.js         — injected into LeetCode problem pages
  neetcode150.js      — the 150-problem dataset (id, slug, title, topic, difficulty)
  popup.js            — popup dashboard logic
  options.js          — settings page logic
icons/
  icon16.png, icon48.png, icon128.png
```
