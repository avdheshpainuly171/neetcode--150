// content.js — injected into leetcode.com/problems/* pages

(function () {
  const slug = location.pathname.split('/problems/')[1]?.replace(/\/$/, '').split('/')[0];
  if (!slug) return;

  const problem = typeof NEETCODE_150 !== 'undefined'
    ? NEETCODE_150.find(p => p.slug === slug)
    : null;

  let alreadyNotified = false;

  // Sends a message to the background service worker, retrying if the
  // worker was asleep and missed the first delivery attempt. MV3 workers
  // sleep after ~30s idle; Chrome is supposed to wake them on an incoming
  // message, but there's a real timing gap where the very first send can
  // arrive before the wake-up finishes registering the listener — this
  // surfaces as "Could not establish connection. Receiving end does not
  // exist." A short retry almost always succeeds since the worker is
  // awake by then.
  function sendToBackground(payload, attempt = 1) {
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          const workerWasAsleep = msg.includes('Receiving end does not exist');

          if (workerWasAsleep && attempt < 4) {
            const delay = attempt * 250; // 250ms, 500ms, 750ms
            console.warn(`[NeetCode Tracker] Worker not ready yet, retrying in ${delay}ms (attempt ${attempt})`);
            setTimeout(() => sendToBackground(payload, attempt + 1), delay);
            return;
          }

          // Anything else (e.g. context invalidated by navigation) is
          // expected sometimes and safe to ignore.
          console.warn('[NeetCode Tracker] No response:', msg);
          return;
        }
        console.log('[NeetCode Tracker] Background response:', res);
      });
    } catch (e) {
      if (attempt < 4) {
        const delay = attempt * 250;
        setTimeout(() => sendToBackground(payload, attempt + 1), delay);
      } else {
        console.warn('[NeetCode Tracker] sendMessage failed after retries:', e.message);
      }
    }
  }

  function handleAccepted() {
    if (alreadyNotified) return;
    alreadyNotified = true;
    console.log('[NeetCode Tracker] Accepted detected:', slug);

    const payload = problem
      ? {
          type: 'PROBLEM_SOLVED', slug: problem.slug, title: problem.title,
          topic: problem.topic, difficulty: problem.difficulty,
          id: problem.id, inNeetCode: true, solvedAt: new Date().toISOString(),
        }
      : {
          type: 'PROBLEM_SOLVED', slug,
          title: document.title.split(' -')[0].trim(),
          topic: null, difficulty: null, inNeetCode: false,
          solvedAt: new Date().toISOString(),
        };

    sendToBackground(payload);

    if (problem) showToast(problem, 'syncing');
    // Reset after 10s so re-submits on the same page can be caught.
    setTimeout(() => { alreadyNotified = false; }, 10000);
  }

  // Background pushes a follow-up message once the real GitHub sync
  // finishes (or fails), so the toast can show what actually happened
  // instead of just "a solve was detected".
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYNC_RESULT' && problem) {
      updateToastResult(msg);
    }
  });

  // ── Method 1: MutationObserver watching the result panel ──────────────
  const observer = new MutationObserver(() => {
    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[class*="accepted"]',
      '[class*="Accepted"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.includes('Accepted')) {
        handleAccepted();
        return;
      }
    }

    const all = document.querySelectorAll('span, div, p');
    for (const el of all) {
      if (el.childElementCount === 0 && el.textContent.trim() === 'Accepted') {
        handleAccepted();
        return;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Method 2: Intercept fetch ───────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';

    if (url.includes('/check') || url.includes('graphql')) {
      try {
        const clone = res.clone();
        const text = await clone.text();
        if (text.includes('"Accepted"') || text.includes('"status_msg":"Accepted"')) {
          handleAccepted();
        }
      } catch (_) {
        // Non-JSON or unreadable body — ignore.
      }
    }
    return res;
  };

  // ── Method 3: Intercept XHR ─────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', function () {
      if ((url.includes('/check') || url.includes('graphql')) &&
          (this.responseText?.includes('"Accepted"') ||
           this.responseText?.includes('"status_msg":"Accepted"'))) {
        handleAccepted();
      }
    });
    return origOpen.apply(this, [method, url, ...rest]);
  };

  function showToast(p, state) {
    const existing = document.getElementById('nc-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'nc-toast';
    toast.dataset.title = p.title;
    toast.dataset.topic = p.topic;
    toast.dataset.difficulty = p.difficulty;
    toast.dataset.id = p.id;
    toast.style.cssText = `
      position:fixed;bottom:32px;right:32px;z-index:99999;
      background:#1a1a2e;color:#e2e8f0;padding:16px 20px;
      border-radius:12px;border-left:4px solid #94a3b8;
      font-family:'Inter',sans-serif;font-size:14px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      display:flex;flex-direction:column;gap:4px;max-width:320px;
      transition:border-color .2s ease;
    `;
    renderToastBody(toast, p, state);
    document.body.appendChild(toast);
    // No auto-remove timer while syncing — updateToastResult clears it.
    if (state !== 'syncing') {
      setTimeout(() => toast.remove(), 5000);
    }
  }

  function renderToastBody(toast, p, state, error) {
    let headline, borderColor;
    if (state === 'syncing') {
      headline = '<span class="nc-spinner"></span> Syncing to GitHub…';
      borderColor = '#94a3b8';
    } else if (state === 'synced') {
      headline = '✅ GitHub Updated!';
      borderColor = '#22c55e';
    } else if (state === 'not_configured') {
      headline = '⚠️ Solved! (GitHub not connected)';
      borderColor = '#f59e0b';
    } else {
      headline = `❌ GitHub sync failed`;
      borderColor = '#ef4444';
    }
    toast.style.borderLeftColor = borderColor;
    toast.innerHTML = `
      <div style="font-weight:600;color:${borderColor};display:flex;align-items:center;gap:6px;">${headline}</div>
      <div style="font-weight:500;">${p.title}</div>
      <div style="color:#94a3b8;font-size:12px;">${p.topic} · ${p.difficulty} · #${p.id}/150</div>
      ${error ? `<div style="color:#ef4444;font-size:11px;margin-top:2px;">${error}</div>` : ''}
      <style>
        .nc-spinner {
          display:inline-block;width:10px;height:10px;border-radius:50%;
          border:2px solid #475569;border-top-color:#94a3b8;
          animation:nc-spin .7s linear infinite;
        }
        @keyframes nc-spin { to { transform: rotate(360deg); } }
      </style>
    `;
  }

  function updateToastResult(result) {
    const toast = document.getElementById('nc-toast');
    if (!toast) return; // already dismissed or page changed — nothing to update

    const p = {
      title: toast.dataset.title,
      topic: toast.dataset.topic,
      difficulty: toast.dataset.difficulty,
      id: toast.dataset.id,
    };

    let state;
    if (result.ok) {
      state = result.reason === 'already_tracked' ? 'synced' : 'synced';
    } else if (result.reason === 'not_configured') {
      state = 'not_configured';
    } else {
      state = 'error';
    }

    renderToastBody(toast, p, state, state === 'error' ? result.error : null);
    setTimeout(() => toast.remove(), state === 'error' || state === 'not_configured' ? 8000 : 4000);
  }

  console.log('[NeetCode Tracker] Active on:', slug, problem ? `(NeetCode #${problem.id})` : '(not in NeetCode 150)');
})();
