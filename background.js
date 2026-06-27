// background.js — Manifest V3 service worker
//
// This file lives at src/background.js, so its own resolved URL is
// chrome-extension://<id>/src/background.js. importScripts() resolves
// relative paths against THAT location (the src/ folder), not the
// extension root — so the sibling file is just 'neetcode150.js', not
// 'src/neetcode150.js'.
try {
  importScripts('neetcode150.js');
  console.log('[NeetCode Tracker] neetcode150.js loaded, problems:', self.NEETCODE_150?.length);
} catch (e) {
  console.error('[NeetCode Tracker] Failed to load neetcode150.js:', e);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PROBLEM_SOLVED') {
    console.log('[NeetCode Tracker] Received:', msg.slug);

    // Respond immediately. The content script doesn't need to wait for
    // the GitHub round-trip — and if it did, a LeetCode SPA navigation
    // (which happens quickly after "Accepted") could tear down the
    // sender's end of the port before the response lands, producing
    // "the message channel closed before a response was received".
    sendResponse({ ok: true, reason: 'queued' });

    const tabId = sender.tab?.id;

    // Do the actual save + GitHub sync after responding, then push a
    // second message back to the same tab with the real outcome, so
    // the toast can reflect what actually happened on GitHub instead
    // of just "a solve was detected".
    handleSolvedProblem(msg)
      .then(result => notifyTab(tabId, { type: 'SYNC_RESULT', ...result }))
      .catch(e => {
        console.error('[NeetCode Tracker] Background sync failed:', e);
        notifyTab(tabId, { type: 'SYNC_RESULT', ok: false, error: e.message });
      });

    return; // no async sendResponse pending — no need to return true
  }
});

function notifyTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Tab may have navigated/closed already — nothing to update, fine.
  });
}

async function handleSolvedProblem(problem) {
  const { githubToken, githubUser, githubRepo } =
    await chrome.storage.sync.get(['githubToken', 'githubUser', 'githubRepo']);

  if (!githubToken || !githubUser || !githubRepo) {
    console.warn('[NeetCode Tracker] GitHub not configured');
    return { ok: false, reason: 'not_configured' };
  }

  const { progress = {} } = await chrome.storage.local.get('progress');

  if (progress[problem.slug]?.solved) {
    console.log('[NeetCode Tracker] Already tracked:', problem.slug);
    return { ok: true, reason: 'already_tracked' };
  }

  progress[problem.slug] = {
    slug: problem.slug,
    title: problem.title,
    topic: problem.topic,
    difficulty: problem.difficulty,
    id: problem.id,
    inNeetCode: problem.inNeetCode,
    solved: true,
    solvedAt: problem.solvedAt,
  };

  await chrome.storage.local.set({ progress });
  console.log('[NeetCode Tracker] Saved locally, pushing to GitHub...');

  try {
    await updateGitHub({ githubToken, githubUser, githubRepo, progress });
    console.log('[NeetCode Tracker] GitHub updated ✅');
    return { ok: true, reason: 'synced' };
  } catch (e) {
    console.error('[NeetCode Tracker] GitHub push failed:', e);
    return { ok: false, reason: 'github_error', error: e.message };
  }
}

// ── GitHub API ───────────────────────────────────────────────────────────

async function updateGitHub({ githubToken, githubUser, githubRepo, progress }) {
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  const base = `https://api.github.com/repos/${githubUser}/${githubRepo}/contents`;

  // Run both file updates in parallel — they're independent files, so
  // there's no reason to wait for progress.json's round-trip before
  // starting README.md's. This roughly halves total time-to-GitHub.
  await Promise.all([
    upsertFile({
      headers, base, path: 'progress.json',
      content: JSON.stringify(progress, null, 2),
      message: buildCommitMsg(progress),
    }),
    upsertFile({
      headers, base, path: 'README.md',
      content: buildReadme(progress),
      message: 'chore: update README progress table',
    }),
  ]);
}

async function upsertFile({ headers, base, path, content, message }, attempt = 1) {
  let sha = null;
  try {
    const r = await fetch(`${base}/${path}`, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch (_) {
    // File probably doesn't exist yet — that's fine, sha stays null.
  }

  const body = { message, content: toBase64(content), ...(sha ? { sha } : {}) };
  const r = await fetch(`${base}/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (r.ok) return;

  const err = await r.json().catch(() => ({}));

  // 409 = sha is stale, almost always because another update (e.g. a
  // second solve fired moments later, or a previous push that hadn't
  // landed yet) changed the file in between our GET and our PUT.
  // Re-fetching the current sha and retrying resolves this safely.
  // 403/429 = rate limited — back off and retry.
  const retryable = r.status === 409 || r.status === 403 || r.status === 429;
  if (retryable && attempt < 4) {
    const delay = attempt * 400; // 400ms, 800ms, 1200ms
    console.warn(`[NeetCode Tracker] ${path} got ${r.status}, retrying in ${delay}ms (attempt ${attempt})`);
    await new Promise(res => setTimeout(res, delay));
    return upsertFile({ headers, base, path, content, message }, attempt + 1);
  }

  throw new Error(`GitHub API ${r.status}: ${err.message || r.statusText}`);
}

function toBase64(str) {
  // btoa needs a binary string; TextEncoder handles UTF-8 (emoji, etc.)
  // correctly first. Works in the service worker context (no Buffer).
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function buildCommitMsg(progress) {
  const solved = Object.values(progress).filter(p => p.inNeetCode && p.solved);
  const last = [...solved].sort((a, b) => new Date(b.solvedAt) - new Date(a.solvedAt))[0];
  return last
    ? `solve: ${last.title} [${last.topic}] (${solved.length}/150)`
    : 'chore: update progress';
}

// ── README builder ───────────────────────────────────────────────────────

function buildReadme(progress) {
  const list = self.NEETCODE_150 || [];
  const solvedSlugs = new Set(
    Object.values(progress).filter(p => p.solved).map(p => p.slug)
  );

  const total = list.length || 150;
  const done = list.filter(p => solvedSlugs.has(p.slug)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  let md = `# 🧠 NeetCode 150 Progress Tracker\n\n`;
  md += `> Auto-updated by NeetCode 150 GitHub Tracker Chrome extension\n\n`;
  md += `## Overall Progress\n\n`;
  md += `\`${progressBar(done, total)}\`\n\n`;
  md += `**${done} / ${total} solved (${pct}%)**\n\n`;

  const topics = [...new Set(list.map(p => p.topic))];
  md += `## By Topic\n\n| Topic | Done | Total | % |\n|-------|------|-------|---|\n`;
  topics.forEach(t => {
    const all = list.filter(p => p.topic === t);
    const d = all.filter(p => solvedSlugs.has(p.slug)).length;
    const topicPct = all.length > 0 ? Math.round((d / all.length) * 100) : 0;
    md += `| ${t} | ${d} | ${all.length} | ${topicPct}% |\n`;
  });

  md += `\n## Solved Problems\n\n| # | Title | Topic | Difficulty | Date |\n|---|-------|-------|------------|------|\n`;
  list.filter(p => solvedSlugs.has(p.slug))
    .sort((a, b) => a.id - b.id)
    .forEach(p => {
      const date = progress[p.slug]?.solvedAt
        ? new Date(progress[p.slug].solvedAt).toLocaleDateString('en-IN')
        : '—';
      const diff = p.difficulty === 'Hard' ? '🔴' : p.difficulty === 'Medium' ? '🟡' : '🟢';
      md += `| ${p.id} | [${p.title}](https://leetcode.com/problems/${p.slug}/) | ${p.topic} | ${diff} ${p.difficulty} | ${date} |\n`;
    });

  md += `\n---\n*Last updated: ${new Date().toUTCString()}*\n`;
  return md;
}

function progressBar(done, total, w = 30) {
  const f = total > 0 ? Math.round((done / total) * w) : 0;
  return `[${'█'.repeat(f)}${'░'.repeat(w - f)}] ${done}/${total}`;
}
